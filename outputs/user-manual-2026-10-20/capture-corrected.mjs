process.argv.push('--library');
const { save } = await import('./capture-remaining.mjs');
const { evaluate } = await import('../../artifacts/table-view-2026-10-19/regression-driver.mjs');
const tab = '49CC32A4988516BED22BA46A30558938';
const native = "document.querySelector('print-designer').shadowRoot";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const action = code => evaluate(tab, `(async()=>{const s=document.querySelector('main').__vueParentComponent.setupState;${code}})()`);
const rect = expression => evaluate(tab, `(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const css = selector => rect(`document.querySelector(${JSON.stringify(selector)})`);
async function select(id) {
  await evaluate(tab, `(()=>{const r=${native},e=r.querySelector('[data-element-id="${id}"]');for(const t of ['mousedown','mouseup','click'])e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,composed:true}));return true})()`);
  await pause(250);
}
async function openProperties() {
  await evaluate(tab, `(()=>{const r=${native};const title=[...r.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='属性面板'&&e.getBoundingClientRect().width>0);if(title)return true;[...r.querySelectorAll('button')].find(e=>e.title.startsWith('元素库 /')).click();return true})()`);
  await pause(100);
  await evaluate(tab, `(()=>{const r=${native};[...r.querySelectorAll('button')].find(e=>e.title==='属性面板'&&e.getBoundingClientRect().width>0)?.click();return true})()`);
  await pause(200);
  await evaluate(tab, `(()=>{const r=${native};[...r.querySelectorAll('button')].find(e=>e.title.startsWith('元素库 /')&&e.getAttribute('aria-expanded')==='true')?.click();return true})()`);
}
await action('await s.enterEditMode();');
await pause(300);
await select('auto-field-2');
await openProperties();
await evaluate(tab, `(()=>{const r=${native};[...r.querySelectorAll('label')].find(e=>e.textContent.trim()==='内容').scrollIntoView({block:'center'});return true})()`);
await pause(250);
console.log(JSON.stringify(evaluate(tab, `(()=>{const r=${native};return [...r.querySelectorAll('label')].filter(e=>['内容','行数','列数','水平间距 (px)','垂直间距 (px)'].includes(e.textContent.trim())).map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))})()`)));
await save('04-field', [
  {label:'点击字段复制',rect:css('[aria-label="复制数据源 客户名称"]')},
  {label:'选中文本组件',rect:rect(`${native}.querySelector('[data-element-id="auto-field-2"]')`)},
  {label:'粘贴到“内容”',rect:rect(`[...${native}.querySelectorAll('label')].find(e=>e.textContent.trim()==='内容')?.parentElement`)}
], {x:0,y:40,w:1200,h:535});
await action('await s.saveTemplate({returnToPreview:true});window.__hostControls.pickerIds=["rec001","rec002","rec003"];await s.loadRecords(true);await s.changeBatchLayout("labels");await s.enterEditMode();');
await pause(400);
await select('__duowei_batch_shared_p0_label-grid');
await openProperties();
await evaluate(tab, `(()=>{const r=${native};[...r.querySelectorAll('label')].find(e=>e.textContent.trim()==='行数').scrollIntoView({block:'center'});return true})()`);
await pause(250);
await save('06-label-edit', [
  {label:'选中标签网格',rect:rect(`${native}.querySelector('[data-element-id="__duowei_batch_shared_p0_label-grid"]')`)},
  {label:'设置行列与间距',rect:{x:918,y:430,w:260,h:210}},
  {label:'保存模板',rect:css('.workspace-actions .button-primary')}
]);
await action('await s.saveTemplate({returnToPreview:true});');
