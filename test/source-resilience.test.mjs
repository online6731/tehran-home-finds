import test from 'node:test';
import assert from 'node:assert/strict';

for(const [name,makeError] of [
  ['timeout',()=>new DOMException('The operation was aborted due to timeout','TimeoutError')],
  ['network failure',()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}})]
]){
  test(`A continuation ${name} does not disable subsequent categories`,async t=>{
    let clock=Date.parse('2026-10-13T03:17:00Z');
    t.mock.method(Date,'now',()=>clock);
    const continuationCategories=[];
    t.mock.method(globalThis,'fetch',async (url,options)=>{
      // Advance the clock so the production two-second request spacing never
      // waits in this test. No real request or timer is needed.
      clock+=3000;
      if(url.startsWith('https://divar.ir/s/tehran/')){
        const state={nb:{listWidgets:[{data:{dto:{data:{token:'new-only',top_description_text:'نو'}}}}],pagination:{hasMore:true,data:{page:1,last_post_date:'2026-10-13T03:00:00Z'}}}};
        return new Response(`<script>window.__PRELOADED_STATE__=${JSON.stringify(state)};</script>`);
      }
      assert.equal(url,'https://api.divar.ir/v8/postlist/w/search');
      const body=JSON.parse(options.body);
      const category=body.search_data.form_data.data.category.str.value;
      assert.equal(body.pagination_data.page,1);
      continuationCategories.push(category);
      if(category==='furniture')throw makeError();
      return Response.json({list_widgets:[],pagination:{has_next_page:false,data:{page:2}}});
    });
    // A fresh module instance isolates the shared endpoint availability state.
    const {collectHtmlCategory}=await import(`../src/source.mjs?resilience=${encodeURIComponent(name)}`);
    const failed=await collectHtmlCategory('furniture',[],undefined,{maxPages:2});
    assert.equal(failed.coverage,'first-source-page');
    assert.equal(failed.hasMore,true);
    assert.equal(failed.failures.length,1);
    assert.match(failed.failures[0],/^Search continuation: /);
    const recovered=await collectHtmlCategory('dining-table',[],undefined,{maxPages:2});
    assert.deepEqual(continuationCategories,['furniture','dining-table']);
    assert.equal(recovered.coverage,'complete-24h-source');
    assert.equal(recovered.pages,2);
    assert.deepEqual(recovered.failures,[]);
  });
}
