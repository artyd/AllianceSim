// Office catalog: plan geometry (rooms, walls, scale), zone types, themes, statuses, moods,
// departments and the furniture catalog. Pure data — no DOM, no state.
export const S=2.25; // office scale: sketch units → meters
export const CS=1.5; // content scale: furniture + people are drawn CS× larger so they read well in the big office
export const OW=14*S, OD=30*S, WALL_H=1.1;
export const sc=a=>a.map(v=>Array.isArray(v)?sc(v):v*S);
export const ROOMS=[
  {id:'r1',n:1,rects:sc([[0,2,4.5,8],[4.5,3.5,6,8]]),polys:sc([[[0,2],[4.5,2],[6,3.5],[6,8],[0,8]]])},{id:'r2',n:2,rects:sc([[0,8,6,12]])},{id:'r3',n:3,rects:sc([[0,12,6,15]])},
  {id:'r4',n:4,rects:sc([[0,15,6,19]])},{id:'r5',n:5,rects:sc([[0,19,6,27]])},{id:'r6',n:6,rects:sc([[0,27,6,30]])},
  {id:'r7',n:7,rects:sc([[8,0,14,4]])},{id:'r8',n:8,rects:sc([[8,4,14,8]])},{id:'r9',n:9,rects:sc([[8,8,14,14]])},
  {id:'r10',n:10,rects:sc([[8,14,14,16.5]])},{id:'r11',n:11,rects:sc([[8,16.5,14,19]])},{id:'r12',n:12,rects:sc([[8,19,14,22]])},
  {id:'r13',n:13,rects:sc([[8,22,14,27]])},{id:'r14',n:14,rects:sc([[8,27,14,30]])},
  {id:'cor',n:0,rects:sc([[6,0,8,30],[0,0,6,2]]),polys:sc([[[6,0],[8,0],[8,30],[6,30]],[[0,0],[6,0],[6,3.5],[4.5,2],[0,2]]]),corridor:true,label:'Коридор'}
];
// walls [x0,z0,x1,z1]
export const WALLS=sc([
  [0,0,2.3,0],[3.7,0,14,0],[0,30,14,30],[0,0,0,30],[14,0,14,30],
  [0,2,4.5,2],[4.5,2,6,3.5],[0,8,6,8],[0,12,6,12],[0,15,6,15],[0,19,6,19],[0,27,6,27],
  [6,3.5,6,6.3],[6,7.5,6,10.5],[6,11.7,6,13.5],[6,14.7,6,17.5],[6,18.7,6,25.3],[6,26.5,6,28.1],[6,29.3,6,30],
  [8,4,14,4],[8,8,14,8],[8,14,14,14],[8,16.5,14,16.5],[8,19,14,19],[8,22,14,22],[8,27,14,27],
  [8,4,8,4.5],[8,5.7,8,8.5],[8,9.7,8,14.3],[8,15.5,8,16.8],[8,18,8,19.5],[8,20.7,8,22.5],[8,23.7,8,28.1],[8,29.3,8,30]
]);
export const ZONES={
  open:{n:'Опен-спейс',c:'#9FD9B0'},meeting:{n:'Переговорна',c:'#A9C4F5'},kitchen:{n:'Кухня',c:'#F6D389'},
  reception:{n:'Рецепція',c:'#F5A9B0'},storage:{n:'Склад',c:'#CFC2AD'},wc:{n:'Санвузол',c:'#A6DDEB'},
  office:{n:'Кабінет',c:'#D2B7F0'},custom:{n:'Своя зона',c:'#F5C08A'}
};
export const THEMES={
  pastel:{bg:'#DCE8F1',base:'#FFFFFF',floor:'#F4EBE1',cor:'#EADFD2',wall:'#FFF8F0',ui:'light',zone:.75},
  wood:{bg:'#E9DCCB',base:'#FBF5EC',floor:'#CFA274',cor:'#BC8C5E',wall:'#F7EFE3',ui:'light',zone:.55},
  white:{bg:'#F1F1F3',base:'#FFFFFF',floor:'#EBEBEE',cor:'#DFDFE4',wall:'#FFFFFF',ui:'light',zone:.7},
  dark:{bg:'#1B1A22',base:'#2B2A34',floor:'#3F3D4C',cor:'#36343F',wall:'#5C596A',ui:'dark',zone:.45}
};
export const DEPT_COLORS=['#E2001A','#F28C28','#F2C036','#5DBE7C','#3EA8C9','#5B76E6','#A36BE0','#E06CA6'];
export const STATUS={office:{n:'В офісі',c:'#4CAF6E',icon:'🏢'},remote:{n:'Працює з дому',c:'#5B76E6',icon:'🏠'},absent:{n:'Немає в офісі',c:'#9AA3AA',icon:'🚶'},sick:{n:'Хворіє',c:'#E8912F',icon:'🤒'},vacation:{n:'У відпустці',c:'#3EC9C0',icon:'🌴'}};
export const MOODS={great:{n:'Чудовий',e:'😄'},good:{n:'Гарний',e:'🙂'},ok:{n:'Нормально',e:'😐'},tired:{n:'Втомлений',e:'😴'},stressed:{n:'У стресі',e:'😫'}};
export const CATS={work:'Робочі місця',meeting:'Переговорні',kitchen:'Кухня',reception:'Рецепція і відпочинок',storage:'Склад і техніка',decor:'Декор'};
export const DEPTS=['Закупівлі','Логістика','IT','Бухгалтерія','Юридичний','HR','Продажі','Маркетинг','Адміністрація','Керівництво','Склад','Підтримка','Виробництво','Сервіс'];
// Ready-made department / personal-office labels for tagging a room's zone (пункт 6).
// Each gets its OWN distinct colour so departments read differently on the plan.
export const ZONE_DEPT_PRESETS=[
  {name:'Закупівлі / Логістика',type:'open',c:'#F2A65A'},{name:'IT',type:'open',c:'#5BC0EB'},
  {name:'Бухгалтерія / Фінанси',type:'open',c:'#7BC96F'},{name:'Юристи',type:'office',c:'#C08CE6'},
  {name:'Продажі',type:'open',c:'#F45B69'},{name:'HR',type:'open',c:'#F6C744'},
  {name:'Кабінет Ольги Валентинівни',type:'office',c:'#E888B4'},{name:'Кабінет Руслана Станіславовича',type:'office',c:'#6C8AE4'}
];
// palette for the colour picker in the zone popover
export const ZONE_PALETTE=['#9FD9B0','#A9C4F5','#F6D389','#F5A9B0','#CFC2AD','#A6DDEB','#D2B7F0','#F5C08A','#F2A65A','#5BC0EB','#7BC96F','#F45B69'];
export const FURN={
  desk:{n:'Стіл',cat:'work',seats:[{x:0,z:.55,ry:Math.PI,y:.45}]},
  doubleDesk:{n:'Подвійний стіл',cat:'work',seats:[{x:0,z:-1.1,ry:0,y:.45},{x:0,z:1.1,ry:Math.PI,y:.45}]},
  chair:{n:'Крісло',cat:'work',seats:[{x:0,z:0,ry:0,y:.45}]},
  monitor:{n:'Монітор',cat:'work',onDesk:true},
  partition:{n:'Перегородка',cat:'work'},
  lockers:{n:'Шафки',cat:'work'},
  meeting:{n:'Стіл для переговорів',cat:'meeting',seats:[{x:-.7,z:1.05,ry:Math.PI,y:.45},{x:0,z:1.05,ry:Math.PI,y:.45},{x:.7,z:1.05,ry:Math.PI,y:.45},{x:-.7,z:-1.05,ry:0,y:.45},{x:0,z:-1.05,ry:0,y:.45},{x:.7,z:-1.05,ry:0,y:.45}]},
  roundTable:{n:'Круглий стіл',cat:'meeting',seats:[{x:0,z:1.05,ry:Math.PI,y:.45},{x:0,z:-1.05,ry:0,y:.45},{x:1.05,z:0,ry:-Math.PI/2,y:.45},{x:-1.05,z:0,ry:Math.PI/2,y:.45}]},
  board:{n:'Дошка',cat:'meeting'},
  tv:{n:'Екран',cat:'meeting'},
  counter:{n:'Кухонна стійка',cat:'kitchen'},
  fridge:{n:'Холодильник',cat:'kitchen'},
  cooler:{n:'Кулер',cat:'kitchen'},
  barTable:{n:'Барний стіл',cat:'kitchen',seats:[{x:-.3,z:.55,ry:Math.PI,y:.7},{x:.3,z:.55,ry:Math.PI,y:.7}]},
  reception:{n:'Стійка рецепції',cat:'reception',seats:[{x:0,z:-.6,ry:0,y:.45}]},
  sofa:{n:'Диван',cat:'reception',seats:[{x:-.42,z:.1,ry:0,y:.4},{x:.42,z:.1,ry:0,y:.4}]},
  armchair:{n:'М’яке крісло',cat:'reception',seats:[{x:0,z:.05,ry:0,y:.4}]},
  bench:{n:'Лавка',cat:'reception',seats:[{x:-.6,z:0,ry:0,y:.4},{x:0,z:0,ry:0,y:.4},{x:.6,z:0,ry:0,y:.4}]},
  coffeeTable:{n:'Журнальний стіл',cat:'reception'},
  shelf:{n:'Книжкова шафа',cat:'storage'},
  rack:{n:'Стелаж',cat:'storage'},
  printer:{n:'Принтер',cat:'storage'},
  plant:{n:'Рослина',cat:'decor'},
  lamp:{n:'Торшер',cat:'decor'},
  deskPC:{n:'Стіл з ПК',cat:'work',seats:[{x:0,z:.55,ry:Math.PI,y:.45}]},
  pod4:{n:'4 місця з ПК',cat:'work',seats:[{x:-.8,z:1.05,ry:Math.PI,y:.45},{x:.8,z:1.05,ry:Math.PI,y:.45},{x:-.8,z:-1.05,ry:0,y:.45},{x:.8,z:-1.05,ry:0,y:.45}]},
  standingDesk:{n:'Стіл-стійка',cat:'work'},
  drawerCab:{n:'Тумба',cat:'work'},
  phoneBooth:{n:'Акустична кабіна',cat:'meeting',seats:[{x:0,z:.1,ry:Math.PI,y:.45}]},
  flipchart:{n:'Фліпчарт',cat:'meeting'},
  diningTable:{n:'Обідній стіл',cat:'kitchen',seats:[{x:-.5,z:.7,ry:Math.PI,y:.45},{x:.5,z:.7,ry:Math.PI,y:.45},{x:-.5,z:-.7,ry:0,y:.45},{x:.5,z:-.7,ry:0,y:.45}]},
  stool:{n:'Табурет',cat:'kitchen',seats:[{x:0,z:0,ry:0,y:.5}]},
  coffeeMachine:{n:'Кавомашина',cat:'kitchen'},
  microwave:{n:'Мікрохвильовка',cat:'kitchen'},
  vending:{n:'Вендінг-автомат',cat:'kitchen'},
  beanbag:{n:'Крісло-мішок',cat:'reception',seats:[{x:0,z:0,ry:0,y:.35}]},
  pouf:{n:'Пуф',cat:'reception',seats:[{x:0,z:0,ry:0,y:.4}]},
  coatRack:{n:'Вішалка',cat:'reception'},
  foosball:{n:'Настільний футбол',cat:'reception'},
  filingCab:{n:'Картотека',cat:'storage'},
  safe:{n:'Сейф',cat:'storage'},
  serverRack:{n:'Серверна шафа',cat:'storage'},
  bigPlant:{n:'Велика рослина',cat:'decor'},
  wallClock:{n:'Годинник',cat:'decor'},
  picture:{n:'Картина',cat:'decor'},
  fan:{n:'Вентилятор',cat:'decor'},
  trashBin:{n:'Кошик',cat:'decor'},
  rug:{n:'Килим',cat:'decor',underlay:true}
};
