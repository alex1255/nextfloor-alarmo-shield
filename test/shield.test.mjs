import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ID, settings, stateStyle, houseBounds, shellMesh, project, findAlarm, viewAdapter, convexHull, plugin } from '../nextfloor-alarmo-shield.js';

const room=(id,x0,z0,x1,z1)=>({id,name:id,points:[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]});
const building={settings:{roof:{sections:[{shape:'hip',base:6,pitch:30,x0:0,x1:8,z0:0,z1:10}]}},floors:[
 {id:'basement',elevation:-2,height:2,rooms:[room('basement',0,0,8,10)],placements:[]},
 {id:'ground',elevation:0,height:3,rooms:[room('entry',0,0,8,10)],placements:[{entity_id:'alarm_control_panel.demo',plugin:{[ID]:{enabled:true}}}]},
 {id:'upper',elevation:3,height:3,rooms:[room('bed',0,0,8,10)],placements:[]},
 {id:'garage',elevation:0,height:2.5,rooms:[room('garage',15,0,18,5)],placements:[]}
]};

test('only armed and delay/alarm states draw a shield; unavailable never looks armed',()=>{
 const cfg=settings();
 for(const state of ['disarmed','disarming','unknown','unavailable','bad_state',null])assert.equal(stateStyle(state,cfg),null);
 for(const state of ['armed_away','armed_home','armed_night','armed_vacation','armed_custom_bypass','arming','pending','triggered'])assert.ok(stateStyle(state,cfg));
 assert.equal(stateStyle('armed_away',settings({enabled:false})),null);
 assert.deepEqual(stateStyle('pending',cfg).color,[255,177,65]);
 assert.equal(stateStyle('triggered',cfg).alarm,true);
});
test('reduced motion and disabled pulse are static; no strobing',()=>{
 const cfg=settings();
 assert.deepEqual(stateStyle('triggered',cfg,0,true),stateStyle('triggered',cfg,0.8,true));
 assert.deepEqual(stateStyle('armed_away',settings({pulse:false}),0),stateStyle('armed_away',settings({pulse:false}),1));
 assert.notEqual(stateStyle('armed_away',cfg,0).alpha,stateStyle('armed_away',cfg,2.5).alpha);
});
test('settings clamp unsafe values and reject unknown colors and string booleans',()=>{
 assert.deepEqual(settings({opacity:1000,margin:-7,color:'__proto__',enabled:'false'}),{enabled:true,opacity:45,margin:0.3,color:'red',pulse:true,grid:false,outbuildings:false,house_only:true,shape:'dome'});
 assert.equal(settings({opacity:'not a number'}).opacity,16);
});
test('house cluster includes basement and roof, detached garage is optional, input stays intact',()=>{
 const before=JSON.stringify(building),box=houseBounds(building,settings());
 assert.equal(box.x0,0);assert.equal(box.x1,8);assert.equal(box.y0,-2);assert.ok(box.y1>8);
 assert.equal(houseBounds(building,settings({outbuildings:true})).x1,18);
 assert.equal(JSON.stringify(building),before);
 assert.equal(houseBounds({floors:[]},settings()),null);
});
test('mesh is finite, spans above the roof and below basement, ring closes without duplicate seam',()=>{
 const box=houseBounds(building,settings()),mesh=shellMesh(box);
 assert.equal(mesh.vertices.length,17*48);assert.equal(mesh.faces.length,16*48*2);
 assert.ok(mesh.vertices.every(p=>p.every(Number.isFinite)));
 assert.ok(Math.max(...mesh.vertices.map(p=>p[1]))>box.y1);
 assert.ok(Math.min(...mesh.vertices.map(p=>p[1]))<box.y0);
 assert.equal(mesh.ring.length,48);
 assert.ok(mesh.faces.every(face=>face.every(i=>i>=0&&i<mesh.vertices.length)));
});
test('sphere encloses the house including the basement and has no ground ring', () => {
 const box = houseBounds(building, settings());
 const { shape } = settings({ shape: 'sphere' });
 const mesh = shellMesh(box, 0.9, 16, 48, shape);
 const [cx, cy, cz] = mesh.center;
 const radius = Math.hypot(box.x1-cx, box.y1-cy, box.z1-cz) + 0.9;
 assert.equal(mesh.ring.length, 0);
 assert.ok(mesh.vertices.every(([x,y,z]) => Math.abs(Math.hypot(x-cx,y-cy,z-cz)-radius) < 1e-9));
 assert.ok(Math.min(...mesh.vertices.map(p => p[1])) < box.y0 - 0.9);
 assert.equal(settings({ shape: 'unknown' }).shape, 'dome');
});
test('projection follows view and perspective, never draws points behind the camera',()=>{
 const I=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 assert.deepEqual(project([0,0,0],I,I,800,600),[400,300,0]);
 assert.deepEqual(project([0.5,0.5,0],I,I,800,600),[600,150,0]);
 const P=[1,0,0,0,0,1,0,0,0,0,-1,-1,0,0,-0.2,0];
 assert.equal(project([0,0,2],I,P,800,600),null);
 assert.ok(project([0,0,-2],I,P,800,600));
});
test('only explicitly configured alarm controls the shell; never guesses another security system',()=>{
 const before=JSON.stringify(building),hass={states:{'alarm_control_panel.demo':{state:'disarmed'},'alarm_control_panel.other':{state:'armed_away'}}};
 assert.equal(findAlarm(building,hass).state,'disarmed');
 assert.equal(findAlarm(building,{states:{}}).state,'unavailable');
 assert.equal(findAlarm({floors:[]},hass),null);assert.equal(JSON.stringify(building),before);
});
test('adapter fails closed when NextFloor internals change and native settings schema is valid',()=>{
 assert.equal(viewAdapter({}),null);assert.equal(viewAdapter({viewer:{camera:{}}}),null);
 assert.equal(plugin.apiVersion,1);
 for(const s of plugin.devices[0].settings){assert.match(s.key,/^\w{1,32}$/);assert.ok(['number','select','boolean'].includes(s.type));}
});
test('silhouette excludes inner points rather than drawing jagged spokes through the house',()=>{
 const hull=convexHull([[0,0],[4,0],[4,4],[0,4],[2,2],[1,1],null,[3,2],[4,4]]);
 assert.equal(hull.length,4);assert.deepEqual(hull,[[0,0],[4,0],[4,4],[0,4]]);
});
test('plugin contains no alarm operations, external imports or network clients',async()=>{
 const source=await readFile(new URL('../nextfloor-alarmo-shield.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\.callService\(|alarm_arm_|alarm_disarm|alarm_trigger|fetch\(|WebSocket\(|XMLHttpRequest|import\s*\(/);
 assert.match(source,/VORSCHAU/);assert.match(source,/Date\.now\(\)\+30000/);
});
