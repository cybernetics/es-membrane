const HandlerNames = window.HandlerNames = {
  // private
  grid: null,
  template: null,
  cachedNames: null,

  /**
   * Initialize the UI.
   */
  init: function() {
    // we start with two rows:  less than that makes no sense.
    this.addRow();
    this.addRow();
  },

  /**
   * Add a graph name row.
   */
  addRow: function() {
    let frag = this.template.content.cloneNode(true);
    this.grid.insertBefore(frag, this.grid.lastElementChild);
    this.update();
  },

  /**
   * Delete a graph name row.
   *
   * @param event {DOMEvent} The click event on a delete button.
   */
  deleteRow: function(event) {
    const range = document.createRange();
    const delButton = event.target;
    range.setEndAfter(delButton);
    range.setStartBefore(
      delButton.previousElementSibling.previousElementSibling
    );
    range.deleteContents();

    this.update();
  },

  /**
   * Update the validity of the elements, and control whether rows can be deleted.
   *
   * @private
   */
  update: function() {
    const buttons = this.grid.getElementsByTagName("button");
    const disabled = (buttons.length <= 3);

    let names = new Set();

    for (let i = 0; i < buttons.length - 1; i++) {
      buttons[i].disabled = disabled;

      let input = buttons[i].previousElementSibling,
      checkbox =  input.previousElementSibling.firstElementChild;
      valid = checkbox.checked || !names.has(input.value);
      input.setCustomValidity(
        valid ? "" : "String names of object graphs must be unique."
      );
      if (!checkbox.checked)
        names.add(input.value);
    }
  },

  get rowCount() {
    return this.grid.getElementsByTagName("button").length - 2;
  },

  setRow: function(index, name, isSymbol) {
    while (this.rowCount < index)
      this.addRow();
    const button = this.grid.getElementsByTagName("button")[index];
    const input = button.previousElementSibling,
    checkbox =  input.previousElementSibling.firstElementChild;

    input.value = name;
    checkbox.checked = isSymbol;
  },

  /**
   * Import the graph names and symbol settings from a configuration file.
   *
   * @param config {JSONObject} The configuration.
   */
  importConfig: function(config) {
    while (config.graphs.length < 2)
      config.graphs.push({name: "", isSymbol: false});
    for (let i = 0; i < config.graphs.length; i++) {
      this.setRow(i, config.graphs[i].name, config.graphs[i].isSymbol);
    }

    const range = document.createRange();
    const delButton = this.grid.getElementsByTagName("button")[
      config.graphs.length
    ];
    range.setEndBefore(this.grid.lastChild);
    range.setStartAfter(delButton);
    range.deleteContents();

    this.update();
  },

  /**
   * Get the graph names to use.
   *
   * @returns [
   *   graphNames       {String[]}  The names of each graph.
   *   graphSymbolLists {Integer[]} Element indexes of symbols in graphNames.
   * ]
   */
  serializableNames: function() {
    const graphNames = [], graphSymbolLists = [];
    const buttons = this.grid.getElementsByTagName("button");
    for (let i = 0; i < buttons.length - 1; i++) {
      let input = buttons[i].previousElementSibling,
      checkbox =  input.previousElementSibling.firstElementChild;

      if (!input.checkValidity())
        continue;

      graphNames.push(input.value);
      if (checkbox.checked)
        graphSymbolLists.push(graphNames.length - 1);
    }
    return [graphNames, graphSymbolLists];
  },

  getFormattedNames: function() {
    const [graphNames, graphSymbolLists] = this.serializableNames();
    return graphNames.map(function(elem, index) {
      elem = JSON.stringify(elem);
      if (graphSymbolLists.length && (graphSymbolLists[0] === index)) {
        graphSymbolLists.shift();
        return `Symbol(${elem})`;
      }
      return elem;
    });
  },

  getGraphNames: function() {
    if (!this.cachedNames) {
      const [graphNames, graphSymbolLists] = this.serializableNames();
      this.cachedNames = graphNames.map(function(elem, index) {
        if (graphSymbolLists.length && (graphSymbolLists[0] === index)) {
          graphSymbolLists.shift();
          return Symbol(elem);
        }
        return elem;
      });
    }
    return this.cachedNames.slice(0);
  },
};

{
  let elems = {
    "grid":           "grid-outer-membrane-objectgraphs",
    "template":       "objectgraph-name-row",
    "graphNamesForm": "grid-outer-membrane-configForm",
  };
  let keys = Reflect.ownKeys(elems);
  keys.forEach(function(key) {
    defineElementGetter(HandlerNames, key, elems[key]);
  });
}
