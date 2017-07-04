/* Reference:  http://soft.vub.ac.be/~tvcutsem/invokedynamic/js-membranes
 * Definitions:
 * Object graph: A collection of values that talk to each other directly.
 */

function MembraneInternal(options = {}) {
  Object.defineProperties(this, {
    "showGraphName": new DataDescriptor(
      Boolean(options.showGraphName), false, false, false
    ),

    "map": new DataDescriptor(
      new WeakMap(/*
        key: ProxyMapping instance

        key may be a Proxy, a value associated with a proxy, or an original value.
      */), false, false, false),

    "handlersByFieldName": new DataDescriptor({}, false, false, false),

    "logger": new DataDescriptor(options.logger || null, false, false, false),

    "__functionListeners__": new DataDescriptor([], false, false, false),

    "warnOnceSet": new DataDescriptor(
      (options.logger ? new Set() : null), false, false, false
    ),

    "modifyRules": new DataDescriptor(new ModifyRulesAPI(this))
  });
}
{ // Membrane definition
MembraneInternal.prototype = Object.seal({
  allTraps: allTraps,

  /**
   * Returns true if we have a proxy for the value.
   */
  hasProxyForValue: function(field, value) {
    var mapping = this.map.get(value);
    return Boolean(mapping) && mapping.hasField(field);
  },

  /**
   * Get the value associated with a field name and another known value.
   *
   * @param field {Symbol|String}  The field to look for.
   * @param value {Variant} The key for the ProxyMapping map.
   *
   * @returns [
   *    {Boolean} True if the value was found.
   *    {Variant} The value for that field.
   * ]
   *
   * @note This method is not used internally in the membrane, but only by debug
   * code to assert that we have the right values stored.  Therefore you really
   * shouldn't use it in Production.
   */
  getMembraneValue: function(field, value) {
    var mapping = this.map.get(value);
    if (mapping && mapping.hasField(field)) {
      return [true, mapping.getValue(field)];
    }
    return [false, NOT_YET_DETERMINED];
  },

  /**
   * Get the proxy associated with a field name and another known value.
   *
   * @param field {Symbol|String}  The field to look for.
   * @param value {Variant} The key for the ProxyMapping map.
   *
   * @returns [
   *    {Boolean} True if the value was found.
   *    {Proxy}   The proxy for that field.
   * ] if field is not the value's origin field
   * 
   * @returns [
   *    {Boolean} True if the value was found.
   *    {Variant} The actual value
   * ] if field is the value's origin field
   *
   * @returns [
   *    {Boolean} False if the value was not found.
   *    {Object}  NOT_YET_DETERMINED
   * ]
   */
  getMembraneProxy: function(field, value) {
    var mapping = this.map.get(value);
    if (mapping && mapping.hasField(field)) {
      return [true, mapping.getProxy(field)];
    }
    return [false, NOT_YET_DETERMINED];
  },

  /**
   * Assign a value to an object graph.
   *
   * @param field {Symbol|String} The name of the object graph.
   * @param value {Variant} The value to assign.
   *
   * Options:
   *   @param mapping {ProxyMapping} A mapping with associated values and proxies.
   *
   * @returns {ProxyMapping} A mapping holding the value.
   */
  buildMapping: function(field, value, options = {}) {
    {
      let t = typeof field;
      if ((t != "string") && (t != "symbol"))
        throw new Error("field must be a string or a symbol!");
    }

    let handler = this.getHandlerByField(field);
    if (!handler)
      throw new Error("We don't have an ObjectGraphHandler with that name!");

    let mapping = ("mapping" in options) ? options.mapping : null;

    if (!mapping) {
      if (this.map.has(value)) {
        mapping = this.map.get(value);
      }
  
      else {
        mapping = new ProxyMapping(field);
      }
    }
    assert(mapping instanceof ProxyMapping,
           "buildMapping requires a ProxyMapping object!");

    const isOriginal = (mapping.originField === field);
    let shadowTarget = makeShadowTarget(value);

    if (!Reflect.isExtensible(value))
      Reflect.preventExtensions(shadowTarget);
    let parts = Proxy.revocable(shadowTarget, handler);
    parts.shadowTarget = shadowTarget;
    parts.value = value;
    mapping.set(this, field, parts);
    makeRevokeDeleteRefs(parts, mapping, field);

    if (!isOriginal) {
      let notifyOptions = { isThis: false };
      ["trapName", "callable", "isThis", "argIndex"].forEach(function(propName) {
        if (Reflect.has(options, propName))
          notifyOptions[propName] = options[propName];
      });
      
      ProxyNotify(parts, handler, notifyOptions);
    }

    handler.addRevocable(isOriginal ? mapping : parts.revoke);
    return mapping;
  },

  hasHandlerByField: function(field) {
    {
      let t = typeof field;
      if ((t != "string") && (t != "symbol"))
        throw new Error("field must be a string or a symbol!");
    }
    return Reflect.ownKeys(this.handlersByFieldName).includes(field);
  },

  /**
   * Get an ObjectGraphHandler object by field name.  Build it if necessary.
   *
   * @param field      {Symbol|String}  The field name for the object graph.
   * @param mustCreate {Boolean} True if we must create a missing graph handler.
   *
   * @returns {ObjectGraphHandler} The handler for the object graph.
   */
  getHandlerByField: function(field, mustCreate = false) {
    if (mustCreate && !this.hasHandlerByField(field))
      this.handlersByFieldName[field] = new ObjectGraphHandler(this, field);
    return this.handlersByFieldName[field];
  },

  /**
   * Determine if the handler is a ObjectGraphHandler for this object graph.
   *
   * @returns {Boolean} True if the handler is one we own.
   */
  ownsHandler: function(handler) {
    if (ChainHandlers.has(handler))
      handler = handler.baseHandler;
    return (handler instanceof ObjectGraphHandler) &&
           (this.handlersByFieldName[handler.fieldName] === handler);
  },

  /**
   * Wrap a value in the object graph for a given ObjectGraphHandler.
   *
   * @param handler {ObjectGraphHandler} The handler for the desired object graph.
   * @param arg     {Variant}            The value to wrap.
   * @param options {Object}             Options to forward to this.buildMapping.
   *
   * @returns {Variant} The value in the targeted object graph.  (NOT a Proxy.)
   */
  wrapArgumentByHandler: function(handler, arg, options = {}) {
    // XXX ajvincent Ensure all callers do not need the return argument!
    if (ChainHandlers.has(handler))
      handler = handler.baseHandler;
    if (!(handler instanceof ObjectGraphHandler) ||
        (handler !== this.getHandlerByField(handler.fieldName)))
      throw new Error("wrapArgumentByHandler:  handler mismatch");
    const type = valueType(arg);
    if (type == "primitive")
      return arg;
    const mayLog = this.__mayLog__();

    let found = this.hasProxyForValue(handler.fieldName, arg);
    if (found)
      return arg;

    let argMap = this.map.get(arg);
    if (mayLog) {
      this.logger.debug("wrapArgumentByHandler found: " + Boolean(argMap));
    }

    let passOptions;
    if (argMap) {
      passOptions = Object.create(options, {
        "mapping": new DataDescriptor(argMap)
      });
    }
    else {
      passOptions = options;
    }

    this.buildMapping(
      handler.fieldName,
      arg,
      passOptions
    );

    return arg; // It may have changed along the way.
  },

  /**
   * Wrap a value for the first time in an object graph.
   *
   * @param mapping {ProxyMapping}  A mapping whose origin field refers to the
   *                                value's object graph.
   * @param arg     {Variant}       The value to wrap.
   *
   * @note This marks the value as the "original" in the new ProxyMapping it
   * creates.
   */
  wrapArgumentByProxyMapping: function(mapping, arg, options = {}) {
    if (this.map.has(arg) || (valueType(arg) === "primitive"))
      return;

    let handler = this.getHandlerByField(mapping.originField);
    this.wrapArgumentByHandler(handler, arg, options);
    
    assert(this.map.has(arg),
           "wrapArgumentByProxyMapping should define a ProxyMapping for arg");
    let argMap = this.map.get(arg);
    assert(argMap instanceof ProxyMapping, "argMap isn't a ProxyMapping?");
    assert(argMap.getOriginal() === arg,
           "wrapArgumentByProxyMapping didn't establish the original?");
  },

  /**
   * Ensure an argument is properly wrapped in a proxy.
   *
   * @param origin {ObjectGraphHandler} Where the argument originated from
   * @param target {ObjectGraphHandler} The object graph we're returning the arg to.
   * @param arg    {Variant}         The argument.
   *
   * @returns {Proxy}   The proxy for that field
   *   if field is not the value's origin field
   * 
   * @returns {Variant} The actual value
   *   if field is the value's origin field
   *
   * @throws {Error} if failed (this really should never happen)
   */
  convertArgumentToProxy:
  function(originHandler, targetHandler, arg, options = {}) {
    var override = ("override" in options) && Boolean(options.override);
    if (override) {
      let map = this.map.get(arg);
      if (map) {
        map.selfDestruct(this);
      }
    }

    if (valueType(arg) === "primitive") {
      return arg;
    }
    if (!this.ownsHandler(originHandler) ||
        !this.ownsHandler(targetHandler) ||
        (originHandler.fieldName === targetHandler.fieldName)) {
      throw new Error("convertArgumentToProxy requires two different ObjectGraphHandlers in the Membrane instance");
    }

    this.wrapArgumentByHandler(originHandler, arg, options);
    this.wrapArgumentByHandler(targetHandler, arg, options);

    let found, rv;
    [found, rv] = this.getMembraneProxy(
      targetHandler.fieldName, arg
    );
    if (!found)
      throw new Error("in convertArgumentToProxy(): proxy not found");
    return rv;
  },

  /**
   * Wrap the methods of a descriptor in an object graph.
   *
   * This method should NOT be exposed to the public.
   */
  wrapDescriptor: function(originField, targetField, desc) {
    if (!desc)
      return desc;

    // XXX ajvincent This optimization may need to go away for wrapping primitives.
    if (isDataDescriptor(desc) && (valueType(desc.value) === "primitive"))
      return desc;

    var keys = Object.keys(desc);

    var wrappedDesc = {
      configurable: Boolean(desc.configurable),
      enumerable: Boolean(desc.enumerable)
    };
    if (keys.includes("writable")) {
      wrappedDesc.writable = Boolean(desc.writable);
      if (!wrappedDesc.configurable && !wrappedDesc.writable)
        return desc;
    }

    var originHandler = this.getHandlerByField(originField);
    var targetHandler = this.getHandlerByField(targetField);

    ["value", "get", "set"].forEach(function(descProp) {
      if (keys.includes(descProp))
        wrappedDesc[descProp] = this.convertArgumentToProxy(
          originHandler,
          targetHandler,
          desc[descProp]
        );
    }, this);

    return wrappedDesc;
  },

  /* Disabled, dead API.
  calledFromHandlerTrap: function() {
    return this.handlerStack[1] !== "external";
  },
  */

  /**
   * Add a listener for function entry, return and throw operations.
   *
   * @param listener {Function} The listener to add.
   *
   * @see ObjectGraphHandler.prototype.notifyFunctionListeners for what each
   * listener will get for its arguments.
   */
  addFunctionListener: function(listener) {
    if (typeof listener != "function")
      throw new Error("listener is not a function!");
    if (!this.__functionListeners__.includes(listener))
      this.__functionListeners__.push(listener);
  },

  /**
   * Add a listener for function entry, return and throw operations.
   *
   * @param listener {Function} The listener to remove.
   */
  removeFunctionListener: function(listener) {
    let index = this.__functionListeners__.indexOf(listener);
    if (index == -1)
      throw new Error("listener is not registered!");
    this.__functionListeners__.splice(index, 1);
  },

  /**
   * A flag indicating if internal properties of the Membrane are private.
   * 
   * @public
   */
  secured: false,

  __mayLog__: MembraneMayLog,

  warnOnce: function(message) {
    if (this.logger && !this.warnOnceSet.has(message)) {
      this.warnOnceSet.add(message);
      this.logger.warn(message);
    }
  },

  get constants() {
    return Constants;
  }
});

} // end Membrane definition
Object.seal(MembraneInternal);
