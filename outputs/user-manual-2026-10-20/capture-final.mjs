process.argv.push('--library');
const { save } = await import('./capture-remaining.mjs');
const { evaluate } = await import('../../artifacts/table-view-2026-10-19/regression-driver.mjs');
const tab='49CC32A4988516BED22BA46A30558938';
const setup="document.querySelector('main').__vueParentComponent.setupState";
const native="document.querySelector('print-designer').shadowRoot";
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const action=code=>evaluate(tab,`(async()=>{const s=${setup};${code}})()`);
const rect=expression=>evaluate(tab,`(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const css=s=>rect(`document.querySelector(${JSON.stringify(s)})`);
await evaluate(tab,`(()=>{const r=${native};[...r.querySelectorAll('button')].find(e=>e.title.startsWith('元素库 /')&&e.getAttribute('aria-expanded')==='true')?.click();[...r.querySelectorAll('label')].find(e=>e.textContent.trim()==='行数').scrollIntoView({block:'center'});return true})()`);
await pause(400);
await save('06-label-edit',[
  {label:'选中标签网格',rect:rect(`${native}.querySelector('[data-element-id="__duowei_batch_shared_p0_label-grid"]')`)},
  {label:'设置行列与间距',rect:{x:918,y:310,w:260,h:240}},
  {label:'保存模板',rect:css('.workspace-actions .button-primary')}
]);
await action('await s.saveTemplate({returnToPreview:true});await s.exitBatchMode();await s.changeBatchLayout("default");await s.enterEditMode();');
await pause(300);
await evaluate(tab,`(()=>{const r=${native},e=r.querySelector('[data-element-id="auto-field-2"]');for(const t of ['mousedown','mouseup','click'])e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,composed:true}));return true})()`);
await pause(200);
await evaluate(tab,`(()=>{const r=${native};[...r.querySelectorAll('label')].find(e=>e.textContent.trim()==='内容').scrollIntoView({block:'center'});return true})()`);
await pause(200);
await save('04-field',[
  {label:'点击字段复制',rect:css('[aria-label="复制数据源 客户名称"]')},
  {label:'选中文本组件',rect:rect(`${native}.querySelector('[data-element-id="auto-field-2"]')`)},
  {label:'粘贴到“内容”',rect:rect(`[...${native}.querySelectorAll('label')].find(e=>e.textContent.trim()==='内容')?.parentElement`)}
],{x:0,y:40,w:1200,h:535});
await action('await s.saveTemplate({returnToPreview:true});s.newTemplateMenuOpen=true;');
await pause(300);
const menu=css('.template-create-menu');
await save('02-new-template',[{label:'选择创建方式',rect:menu}],{x:0,y:menu.y-12,w:190,h:660-menu.y+12});
await action('s.newTemplateMenuOpen=false;');
