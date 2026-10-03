const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, loadStores, findElements } = require('./runtime.cjs');
const user = { user_id: 1, username: 'one', email: 'one@test' };
const address = { address_id: 41, receiver_name: 'Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一路 1 号', is_default: false, user_id: 1 };
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : '';
const button = (tree, label) => findElements(tree, element => element.type === 'button' && text(element) === label)[0];
const input = (tree, name) => findElements(tree, element => element.props.name === name)[0];
function setup({ list = async () => ({ addresses: [address] }), create = async () => ({}), update = async () => ({}), remove = async () => ({}) } = {}) {
  const stores = loadStores(); stores.useAuthStore.getState().login(user, 'one');
  const requests = [], notifications = [];
  const toast = { error: value => notifications.push(value), success: value => notifications.push(value) };
  const runtime = loadPage('src/app/profile/address/page.tsx', { globals: { ...stores, confirm: () => true }, imports: {
    '@/store/useAuthStore': { useAuthStore: Object.assign(() => stores.useAuthStore.getState(), { getState: stores.useAuthStore.getState }) },
    'react-hot-toast': { __esModule: true, default: toast, toast },
    '@/lib/api': { addressApi: {
      list, create: async body => { requests.push({ method: 'create', body: JSON.parse(JSON.stringify(body)) }); return create(body); },
      update: async (id, body) => { requests.push({ method: 'update', id, body: JSON.parse(JSON.stringify(body)) }); return update(id, body); },
      remove: async id => { requests.push({ method: 'remove', id }); return remove(id); },
    } },
  } });
  return { ...stores, runtime, requests, notifications };
}

test('address management adds, edits, sets default and deletes using owned full fields only', async () => {
  const context = setup(); let tree = await context.runtime.flush({});
  assert.ok(text(tree).includes('Receiver'));
  button(tree, '新增地址').props.onClick(); tree = await context.runtime.flush();
  for (const name of ['receiver_name', 'phone', 'province', 'city', 'district', 'detail_address']) {
    input(tree, name).props.onChange({ target: { value: address[name] } }); tree = await context.runtime.flush();
  }
  input(tree, 'is_default').props.onChange({ target: { checked: true } }); tree = await context.runtime.flush();
  await findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(context.requests[0], { method: 'create', body: { receiver_name: 'Receiver', phone: '+86 138-0013-8000', province: '浙江省', city: '杭州市', district: '西湖区', detail_address: '文一路 1 号', is_default: true } });
  tree = await context.runtime.flush(); button(tree, '编辑').props.onClick(); tree = await context.runtime.flush();
  input(tree, 'detail_address').props.onChange({ target: { value: '文一路 2 号' } }); tree = await context.runtime.flush();
  await findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.equal(context.requests[1].id, 41); assert.equal(context.requests[1].body.detail_address, '文一路 2 号');
  assert.ok(!Object.hasOwn(context.requests[1].body, 'user_id')); assert.ok(!Object.hasOwn(context.requests[1].body, 'address_id'));
  tree = await context.runtime.flush(); await button(tree, '设为默认').props.onClick();
  assert.equal(context.requests[2].body.is_default, true);
  assert.equal(context.requests[2].body.receiver_name, 'Receiver');
  tree = await context.runtime.flush(); await button(tree, '删除').props.onClick();
  assert.deepEqual(context.requests[3], { method: 'remove', id: 41 });
});

test('invalid phone and required fields prevent address writes and show actionable validation', async () => {
  const { runtime, requests } = setup(); let tree = await runtime.flush({});
  button(tree, '新增地址').props.onClick(); tree = await runtime.flush();
  await findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = await runtime.flush();
  assert.ok(text(tree).includes('请填写')); assert.deepEqual(requests, []);
  for (const name of ['receiver_name', 'phone', 'province', 'city', 'district', 'detail_address']) {
    input(tree, name).props.onChange({ target: { value: name === 'phone' ? '123' : address[name] } }); tree = await runtime.flush();
  }
  await findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = await runtime.flush();
  assert.ok(text(tree).includes('7 至 15')); assert.deepEqual(requests, []);
});

test('address request failures can retry and server validation keeps edits available for correction', async () => {
  let calls = 0;
  const context = setup({ list: async () => { if (++calls === 1) throw new Error('Unavailable'); return { addresses: [address] }; },
    update: async () => { throw { response: { data: { error: '最多保存20个地址' } } }; } });
  let tree = await context.runtime.flush({}); assert.ok(text(tree).includes('加载收货地址失败'));
  await button(tree, '重新加载地址').props.onClick(); tree = await context.runtime.flush();
  button(tree, '编辑').props.onClick(); tree = await context.runtime.flush();
  await findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = await context.runtime.flush();
  assert.ok(text(tree).includes('最多保存20个地址')); assert.equal(input(tree, 'receiver_name').props.value, address.receiver_name);
});

test('an account change hides old addresses immediately and a late list cannot restore them', async () => {
  let finishFirst; const pending = new Promise(resolve => { finishFirst = resolve; });
  let calls = 0;
  const context = setup({ list: () => ++calls === 1 ? pending : Promise.resolve({ addresses: [{ ...address, address_id: 42, receiver_name: 'Second Receiver' }] }) });
  await context.runtime.flush({});
  context.useAuthStore.getState().login({ ...user, user_id: 2 }, 'two');
  let tree = await context.runtime.render(); assert.ok(!text(tree).includes('Receiver'));
  tree = await context.runtime.flush(); assert.ok(text(tree).includes('Second Receiver'));
  finishFirst({ addresses: [address] }); await new Promise(setImmediate); tree = await context.runtime.flush();
  assert.ok(text(tree).includes('Second Receiver')); assert.equal(calls, 2);
});

test('late address mutations after account, storage or unmount changes cannot refresh or report success', async () => {
  for (const change of ['account', 'storage', 'unmount']) {
    for (const outcome of ['success', 'failure']) {
      let finish, fail; const pending = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
      let lists = 0;
      const context = setup({ list: async () => { lists++; return { addresses: [address] }; }, update: () => pending });
      const tree = await context.runtime.flush({}); const mutation = button(tree, '设为默认').props.onClick();
      if (change === 'account') { context.useAuthStore.getState().login({ ...user, user_id: 2 }, 'two'); await context.runtime.flush(); }
      if (change === 'storage') context.localStorage.setItem('token', 'two');
      if (change === 'unmount') context.runtime.unmount();
      const expectedLists = lists;
      if (outcome === 'success') finish({}); else fail({ response: { data: { error: '旧地址错误' } } });
      await mutation;
      assert.equal(lists, expectedLists, `${change}/${outcome}`); assert.deepEqual(context.notifications, []);
    }
  }
});

test('a stale address form cannot send another tab customer a mutation', async () => {
  const context = setup(); let tree = await context.runtime.flush({});
  button(tree, '编辑').props.onClick(); tree = await context.runtime.flush();
  context.localStorage.setItem('token', 'two');
  await findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  assert.deepEqual(context.requests, []);
});

test('legacy NULL address regions edit as blank required fields and never crash or send incomplete data', async () => {
  const context = setup({ list: async () => ({ addresses: [{ ...address, province: null, city: null, district: null }] }) });
  let tree = await context.runtime.flush({}); button(tree, '编辑').props.onClick(); tree = await context.runtime.flush();
  for (const name of ['province', 'city', 'district']) assert.equal(input(tree, name).props.value, '');
  await findElements(tree, element => element.type === 'form')[0].props.onSubmit({ preventDefault() {} }); tree = await context.runtime.flush();
  assert.ok(text(tree).includes('请填写省份')); assert.deepEqual(context.requests, []);
});
