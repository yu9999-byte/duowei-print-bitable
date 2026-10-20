process.argv.push('--library');
const { save } = await import('./capture-remaining.mjs');
const { cdp, evaluate, waitFor } = await import('../../artifacts/table-view-2026-10-19/regression-driver.mjs');
const tab='49CC32A4988516BED22BA46A30558938';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const setup="document.querySelector('main').__vueParentComponent.setupState";
const action=code=>evaluate(tab,`(async()=>{const s=${setup};${code}})()`);
const rect=expression=>evaluate(tab,`(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const css=s=>rect(`document.querySelector(${JSON.stringify(s)})`);
const button=pattern=>rect(`[...document.querySelectorAll('button')].find(e=>${pattern}.test(e.innerText.trim()))`);
const native="document.querySelector('print-designer').shadowRoot";
await evaluate(tab,`(()=>{const r=${native};[...r.querySelectorAll('label')].find(e=>e.textContent.trim()==='内容').scrollIntoView({block:'center'});return true})()`);
await pause(500);
await save('04-field',[
  {label:'点击字段复制',rect:css('[aria-label="复制数据源 客户名称"]')},
  {label:'选中文本组件',rect:rect(`${native}.querySelector('[data-element-id="auto-field-2"]')`)},
  {label:'粘贴到“内容”',rect:rect(`[...${native}.querySelectorAll('label')].find(e=>e.textContent.trim()==='内容')?.parentElement`)}
]);
await action('await s.saveTemplate({returnToPreview:true});window.__hostControls.pickerIds=["rec001","rec002","rec003"];await s.loadRecords(true);');
await pause(2700);
await save('05-batch',[
  {label:'核对已选记录',rect:css('.workspace-heading')},
  {label:'选择排版方式',rect:css('.batch-layout-switch')},
  {label:'导出或打印',rect:(()=>{const a=button('/^导出.*PDF$/'),b=button('/^打印/');return a&&b?{x:a.x,y:a.y,w:b.x+b.w-a.x,h:a.h}:null})()}
],{x:185,y:40,w:1015,h:390});
await action('await s.changeBatchLayout("labels");await s.enterEditMode();');
await pause(600);
await evaluate(tab,`(()=>{const r=${native};const b=[...r.querySelectorAll('button')].find(e=>e.title.startsWith('元素库 /'));b.click();return true})()`);
await pause(100);
await evaluate(tab,`(()=>{const r=${native};const b=[...r.querySelectorAll('button')].find(e=>e.title==='属性面板'&&e.getBoundingClientRect().width);if(b)b.click();return true})()`);
await pause(200);
await evaluate(tab,`(()=>{const r=${native};const e=r.querySelector('[data-element-id="label-grid"]');if(e)for(const type of ['mousedown','mouseup','click'])e.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,composed:true}));return true})()`);
await pause(300);
console.log(JSON.stringify(evaluate(tab,`(()=>{const r=${native};return {elements:document.querySelector('print-designer').getTemplateData().pages[0].elements.map(e=>({id:e.id,type:e.type})),labels:[...r.querySelectorAll('label')].map(e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))}})()`)));
await save('06-label-edit',[
  {label:'标签网格',rect:rect(`${native}.querySelector('[data-element-id="label-grid"]')`)},
  {label:'编辑第一格内容',rect:rect(`${native}.querySelector('[data-element-id="auto-label-order"]')`)},
  {label:'保存模板',rect:button('/^保存模板$/')}
]);
await action('await s.saveTemplate({returnToPreview:true});');
await pause(2700);
await save('07-label-preview',[
  {label:'一条记录对应一个标签',rect:css('.workspace-heading')},
  {label:'先试打一张',rect:button('/^打印/')}
],{x:185,y:40,w:1015,h:550});
