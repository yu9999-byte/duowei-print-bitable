// Adapt the pinned designer's table creation flow at build time, without
// changing node_modules or the existing table editing/data-binding behavior.
module.exports = function designerTableLoader(source) {
  const fieldsStart = '    const tableCreateFields = computed(() => [';
  if (!source.includes(fieldsStart)) return source;
  const replaceOnce = (before, after) => {
    if (source.split(before).length !== 2) {
      throw new Error('Designer table creation changed; review the table adapter.');
    }
    source = source.replace(before, after);
  };
  replaceOnce('      mode: "testData",', '      mode: "custom",');
  const modeStart = source.indexOf(fieldsStart) + fieldsStart.length;
  const columnsStart = source.indexOf('      {\n        key: "columns",', modeStart);
  if (columnsStart < modeStart || !source.slice(modeStart, columnsStart).includes('canvas.tableCreateWithTestData')) {
    throw new Error('Designer table fields changed; review the table adapter.');
  }
  source = source.slice(0, modeStart) + '\n' + source.slice(columnsStart);
  // The form only submits visible fields. Always take the empty-table branch.
  replaceOnce(
    'const mode = String((payload == null ? void 0 : payload.mode) || "testData");',
    'const mode = "custom";',
  );
  const condition = '        showWhen: { key: "mode", value: "custom" }\n';
  if (source.split(condition).length !== 3) {
    throw new Error('Designer table row/column fields changed; review the table adapter.');
  }
  source = source.replaceAll(condition, '');
  return source;
};
