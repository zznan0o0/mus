'use strict';
const utils = require('./utils');
const globalFilters = require('./filters');
const deepGet = require('lodash/get');
let filters;
let macroFunctions;

module.exports = function(ast, scope, ft = {}) {
  filters = ft;
  macroFunctions = new Map();

  // process ast
  processMacro(ast.macro);
  const result = processAst(ast.root, scope);

  filters = null;
  macroFunctions.clear();
  return result;
};

function processAst(ast, scope = {}) {
  let html = '';
  for (let i = 0; i < ast.length; i++) {
    const el = ast[i];

    // istanbul ignore else
    if (el.type === 2) {
      // text handling
      html += el.text;
    } else if (el.type === 3) {
      // variable handling
      if (el.methodName && macroFunctions.has(el.methodName)) {
        scope[el.methodName] = macroFunctions.get(el.methodName)(scope)
      }

      const result = computedExpression(scope, el);
      html += el.safe ? result : utils.escape(result);
    } else if (el.type === 1) {
      // block handling
      if (el.for) {
        html += processFor(el, scope);
      } else if (el.if) {
        html += processIf(el, scope);
      } else if (el.set) {
        scope[el.key] = computedExpression(scope, el);
      } else if (el.raw) {
        html += processAst(el.children);
      }
    }
  }

  return html;
}

function processMacro(macro) {
  macro.forEach(el => {
    let setScope = '';

    utils.forEach(el.args.split(','), (item, index) => {
      setScope += `scope['${item.trim()}'] = arguments[${index}];`;
    });

    // create macro function with scope
    macroFunctions.set(el.item, (scope) => {
      return new Function(
        'scope',
        'processAst',
        'root',
        `return function(${el.args || ''}){
           ${setScope}
           return processAst(root, scope);
        }`
      )(scope, processAst, el.children);
    });
  })
}

// for
function processFor(el, scope) {
  const result = computedExpression(scope, el);
  let html = '';
  utils.forEach(result, (value, key, index, len) => {
    const o = {
      [el.value]: value,
      loop: {
        index: index + 1,
        index0: index,
        length: len,
      }
    };

    if (el.index) {
      o[el.index] = key;
    }

    html += processAst(el.children, Object.assign({}, scope, o));
  });
  return html;
}

// if
function processIf(el, scope) {
  let html = '';
  // check if
  if (computedExpression(scope, el)) {
    html += processAst(el.children, scope);
  } else {
    let elseIfAdded = false;

    // check else if
    if (el.elseifBlock) {
      for (let j = 0; j < el.elseifBlock.length; j++) {
        const elseifBlock = el.elseifBlock[j];
        if (computedExpression(scope, elseifBlock)) {
          elseIfAdded = true;
          html += processAst(elseifBlock.children, scope);
          break;
        }
      }
    }

    // check else
    if (!elseIfAdded && el.elseBlock) {
      html += processAst(el.elseBlock.children, scope);
    }
  }
  return html;
}

function processFilter(filterName, str) {
  const filter = filters[filterName] || globalFilters[filterName];

  if (!filter) {
    throw new Error(`unknown filter ${filterName}`);
  }

  return filter(str);
}

function computedExpression(scope, el) {
  let result;
  const expression = el.expression;
  // performance: deepGet > new Function > with + new Function
  if (el.isString || el.isNumber) {
    result = el.expression;
  } else if (el.isObject) {
    result = deepGet(scope, expression, '');
  } else {
    const methodBody = `return (${expression})`;
    const funcString = scope ? `with(_$o){ ${methodBody} }` : methodBody;
    const func = new Function('_$o', funcString);
    try {
      result = func(scope);
      result = (result === undefined || result === null) ? '' : result;
    } catch (e) {
      // only catch the not defined error
      if (e.message.indexOf('is not defined') >= 0) {
        result = '';
      } else {
        throw e;
      }
    }
  }

  if (el.filters) {
    utils.forEach(el.filters, filter => {
      result = processFilter(filter, result);
    });
  }

  return result;
}