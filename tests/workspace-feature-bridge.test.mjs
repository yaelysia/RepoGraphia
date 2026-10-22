import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../viewer/workspace-bridge.js', import.meta.url), 'utf8');
const origin = 'http://127.0.0.1:30123', snapshot = 'a'.repeat(64), originalDigest = 'b'.repeat(64);

// Exercise the browser boundary with explicit event sources and independent documents.
// The mocked platform supplies no network, target code, or persistence capability.
function fixture() {
  const messages = [], callbacks = new Map(), inputCallbacks = new Map();
  let observe, documentValue = {revision:0,basis:{snapshot}}, saves = 0, navigations = 0;
  const references = [];
  const parent = {postMessage:(data,target)=>messages.push({data,target})};
  const window = {parent,origin,addEventListener:(type,callback)=>callbacks.set(type,callback)};
  const document = {
    body:{},getElementById:id=>id === 'workspace-data' ? {textContent:JSON.stringify({snapshot,featureDigest:originalDigest})} : null,
    querySelector:()=>null,addEventListener:(type,callback)=>inputCallbacks.set(type,callback),
  };
  class Input {
    constructor(value) {this.value=value;this.type='text';this.isConnected=true;}
    matches() {return true;}
    closest() {return {};}
  }
  const context = vm.createContext({window,document,Element:Input,crypto:{randomUUID:()=> 'fixture-instance'},
    MutationObserver:class {constructor(callback) {observe=callback;}observe() {}},setTimeout});
  vm.runInContext(source, context);
  const bridge = context.createWorkspaceBridge();
  bridge.attach({document:()=>documentValue,saved:()=>saves++,references:report=>references.push(report),navigate:()=>{navigations++;return true;}});
  const send = (data, overrides={}) => callbacks.get('message')({source:parent,origin,data:{channel:'repographia-workspace-v1',instance:'fixture-instance',snapshot,...data},...overrides});
  const report = (featureDigest=originalDigest,revision=documentValue.revision) => ({referenceVersion:1,snapshot,featureDigest,revision,mappings:[],features:[]});
  return {bridge,send,report,messages,references,Input,input:(type,target)=>inputCallbacks.get(type)({target}),observe:()=>observe(),
    get saves(){return saves;},get navigations(){return navigations;},set document(value){documentValue=value;}};
}

test('feature-work bridge rejects foreign windows, origins, snapshots and annotation versions', () => {
  const f = fixture(), valid = {type:'reference-status',featureDigest:originalDigest,references:f.report()};
  f.send(valid,{source:{}});f.send(valid,{origin:'https://elsewhere.invalid'});
  f.send({...valid,snapshot:'c'.repeat(64)});
  f.send({...valid,featureDigest:'d'.repeat(64)});
  f.send({...valid,references:f.report(originalDigest,9)});
  assert.equal(f.references.length,0);
  f.send(valid);assert.equal(f.references.length,1);
  assert.ok(f.messages.every(message=>message.target === origin));
});

test('only the newest save acknowledgement enables reference status for its saved document', () => {
  const f = fixture(), digestOne = 'c'.repeat(64), digestTwo = 'd'.repeat(64);
  f.document = {revision:1,basis:{snapshot}};f.bridge.changed({revision:1,basis:{snapshot}});
  f.document = {revision:2,basis:{snapshot}};f.bridge.changed({revision:2,basis:{snapshot}});
  f.send({type:'saved',editId:1,featureDigest:digestOne,revision:1});
  assert.equal(f.saves,0);
  f.send({type:'reference-status',featureDigest:originalDigest,references:f.report()});
  assert.equal(f.references.length,0);
  f.send({type:'saved',editId:2,featureDigest:digestTwo,revision:2});
  assert.equal(f.saves,1);
  f.send({type:'reference-status',featureDigest:digestOne,references:f.report(digestOne,1)});
  assert.equal(f.references.length,0);
  f.send({type:'reference-status',featureDigest:digestTwo,references:f.report(digestTwo,2)});
  assert.equal(f.references.length,1);
});

test('incoming reference updates and navigation do not replace an unapplied form', () => {
  const f = fixture(), input = new f.Input('original');
  f.input('focusin',input);input.value='unapplied';f.input('input',input);
  f.send({type:'reference-status',featureDigest:originalDigest,references:f.report()});
  f.send({type:'navigate',featureDigest:originalDigest,featureId:'known-feature'});
  assert.equal(f.references.length,0);
  assert.equal(f.navigations,0);
  assert.equal(f.messages.at(-1).data.type,'navigation-result');
  assert.equal(f.messages.at(-1).data.ok,false);
  input.isConnected=false;f.observe();
  assert.equal(f.references.length,1);
  f.send({type:'navigate',featureDigest:originalDigest,featureId:'known-feature'});
  assert.equal(f.navigations,1);
  assert.equal(f.messages.at(-1).data.ok,true);
});
