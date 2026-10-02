// 别墅平面（单位：米；x 向东，z 向南，正门在南侧 z=+9）
//
//   z=-9 ┌──────────┬────────────┬─────────┐
//        │  卧 室    │   客 厅     │  书 房   │
//   z=-1 ├───┤ ├────┴───┤  ├─────┴──┤ ├────┤
//        │            回 忆 长 廊              │
//   z= 2 ├───┤ ├────┬───┤  ├────┬───┤ ├────┤
//        │  厨 房    │   门 厅     │  儿童房  │
//   z= 9 └──────────┴────┤门├─────┴─────────┘
//       x=-13       x=-4        x=4  x=6     x=13
//
// 墙洞 openings: { side: 'n'|'s'|'w'|'e', at: 沿墙中心坐标, w: 宽, h: 高, sill: 离地高度(门为0), kind: 'door'|'window' }
// 展位 slots.wall: { at:[x,z] 墙内表面上的点, rot: 朝向 } —— 大件（家具、家电）靠墙
//      slots.pedestal: [x,z] —— 小件放在展台上

export const VILLA = { minX: -13, maxX: 13, minZ: -9, maxZ: 9, height: 3.2, wallT: 0.12 };

const N = 0, S = Math.PI, W = Math.PI / 2, E = -Math.PI / 2;

export const ROOMS = [
  {
    id: 'bedroom', name: '卧室', en: 'Bedroom',
    hint: '衣柜、床、梳妆台、衣物、被褥、首饰、闹钟',
    rect: [-13, -9, -4, -1],
    finish: { floor: 'oak-planks', wall: 'wallpaper-cream', dado: null, light: '#ffe4c2' },
    openings: [
      { side: 's', at: -8.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 'n', at: -11.4, w: 1.4, h: 1.6, sill: 0.9, kind: 'window' },
      { side: 'n', at: -5.6, w: 1.4, h: 1.6, sill: 0.9, kind: 'window' },
      { side: 'w', at: -5, w: 1.8, h: 1.7, sill: 0.8, kind: 'window' },
    ],
    slots: {
      wall: [
        { at: [-8.5, -8.88], rot: N }, { at: [-12.88, -3.2], rot: W }, { at: [-4.12, -6.6], rot: E },
        { at: [-4.12, -3.2], rot: E }, { at: [-12.88, -7.4], rot: W }, { at: [-10.2, -8.88], rot: N }, { at: [-6.8, -8.88], rot: N },
      ],
      pedestal: [[-10.3, -5.6], [-6.7, -5.6], [-10.3, -3.4], [-6.7, -3.4], [-8.5, -4.5]],
    },
  },
  {
    id: 'living', name: '客厅', en: 'Living Room',
    hint: '电视机、收音机、沙发、茶几、电风扇、钟表、摆件、相册',
    rect: [-4, -9, 6, -1],
    finish: { floor: 'parquet', wall: 'paint-white', dado: 'paint-green', light: '#ffe2b8' },
    openings: [
      { side: 's', at: 1, w: 3, h: 2.6, sill: 0, kind: 'door' },
      { side: 'n', at: -1.5, w: 2.2, h: 2.0, sill: 0.6, kind: 'window' },
      { side: 'n', at: 3.5, w: 2.2, h: 2.0, sill: 0.6, kind: 'window' },
    ],
    slots: {
      wall: [
        { at: [1, -8.88], rot: N }, { at: [-3.88, -5], rot: W }, { at: [5.88, -5], rot: E },
        { at: [-3.88, -2.6], rot: W }, { at: [5.88, -2.6], rot: E }, { at: [-3.88, -7.4], rot: W }, { at: [5.88, -7.4], rot: E },
      ],
      pedestal: [[-1.6, -5.6], [1, -5.6], [3.6, -5.6], [-1.6, -3.4], [3.6, -3.4], [1, -3.4]],
    },
  },
  {
    id: 'study', name: '书房', en: 'Study',
    hint: '书籍、文具、钢笔、台灯、电脑、相机、乐器、奖状',
    rect: [6, -9, 13, -1],
    finish: { floor: 'walnut-planks', wall: 'paint-deepgreen', dado: 'wood-panel', light: '#ffd8a0' },
    openings: [
      { side: 's', at: 9.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 'e', at: -5, w: 1.8, h: 1.8, sill: 0.8, kind: 'window' },
      { side: 'n', at: 9.5, w: 1.6, h: 1.6, sill: 0.9, kind: 'window' },
    ],
    slots: {
      wall: [{ at: [6.12, -5.5], rot: W }, { at: [12.88, -2.6], rot: E }, { at: [7.6, -8.88], rot: N }, { at: [11.4, -8.88], rot: N }, { at: [6.12, -2.8], rot: W }],
      pedestal: [[8.4, -5.6], [10.6, -5.6], [8.4, -3.5], [10.6, -3.5]],
    },
  },
  {
    id: 'hall', name: '回忆长廊', en: 'Gallery Hall',
    hint: '挂着每件藏品的原始照片',
    rect: [-13, -1, 13, 2],
    finish: { floor: 'terrazzo', wall: 'paint-warm', dado: 'paint-terracotta', light: '#ffe6c4' },
    corridor: true,
    openings: [
      { side: 'n', at: -8.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 'n', at: 1, w: 3, h: 2.6, sill: 0, kind: 'door' },
      { side: 'n', at: 9.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 's', at: -8.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 's', at: 0, w: 3, h: 2.6, sill: 0, kind: 'door' },
      { side: 's', at: 8.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 'w', at: 0.5, w: 1.4, h: 2.0, sill: 0.6, kind: 'window' },
      { side: 'e', at: 0.5, w: 1.4, h: 2.0, sill: 0.6, kind: 'window' },
    ],
    slots: { wall: [], pedestal: [] },
  },
  {
    id: 'kitchen', name: '厨房餐厅', en: 'Kitchen & Dining',
    hint: '碗碟、搪瓷杯、暖水瓶、锅具、饭盒、冰箱、餐桌椅',
    rect: [-13, 2, -4, 9],
    finish: { floor: 'red-tiles', wall: 'paint-white', dado: 'white-tiles', light: '#fff0d6' },
    openings: [
      { side: 'n', at: -8.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 's', at: -10.5, w: 1.6, h: 1.4, sill: 1.0, kind: 'window' },
      { side: 's', at: -6.5, w: 1.6, h: 1.4, sill: 1.0, kind: 'window' },
      { side: 'w', at: 5.5, w: 1.4, h: 1.4, sill: 1.0, kind: 'window' },
    ],
    slots: {
      wall: [{ at: [-12.88, 3.6], rot: W }, { at: [-4.12, 5.5], rot: E }, { at: [-8.5, 8.88], rot: S }, { at: [-12.88, 7.6], rot: W }, { at: [-4.12, 3.4], rot: E }],
      pedestal: [[-10.4, 4.6], [-6.6, 4.6], [-10.4, 6.6], [-6.6, 6.6], [-8.5, 5.6]],
    },
  },
  {
    id: 'foyer', name: '门厅', en: 'Foyer',
    hint: '自行车、鞋、包、雨伞、行李箱，以及不知道放哪儿的旧物',
    rect: [-4, 2, 4, 9],
    finish: { floor: 'terrazzo', wall: 'paint-warm', dado: 'paint-terracotta', light: '#ffe6c4' },
    entrance: true,
    openings: [
      { side: 'n', at: 0, w: 3, h: 2.6, sill: 0, kind: 'door' },
      { side: 's', at: 0, w: 1.8, h: 2.6, sill: 0, kind: 'door' },
      { side: 's', at: -2.6, w: 1.0, h: 1.8, sill: 0.7, kind: 'window' },
      { side: 's', at: 2.6, w: 1.0, h: 1.8, sill: 0.7, kind: 'window' },
    ],
    slots: {
      wall: [{ at: [-3.88, 5.2], rot: W }, { at: [3.88, 5.2], rot: E }, { at: [-3.88, 7.6], rot: W }, { at: [3.88, 7.6], rot: E }, { at: [-3.88, 3.2], rot: W }, { at: [3.88, 3.2], rot: E }],
      pedestal: [[-1.8, 4.4], [1.8, 4.4], [-1.8, 6.6], [1.8, 6.6]],
    },
  },
  {
    id: 'kids', name: '儿童房', en: "Children's Room",
    hint: '玩具、布娃娃、课本、书包、铁皮青蛙、小人书、游戏机',
    rect: [4, 2, 13, 9],
    finish: { floor: 'light-planks', wall: 'paint-skyblue', dado: 'paint-cream', light: '#fff1d0' },
    openings: [
      { side: 'n', at: 8.5, w: 1.6, h: 2.4, sill: 0, kind: 'door' },
      { side: 's', at: 6.5, w: 1.6, h: 1.6, sill: 0.8, kind: 'window' },
      { side: 's', at: 10.5, w: 1.6, h: 1.6, sill: 0.8, kind: 'window' },
      { side: 'e', at: 5.5, w: 1.6, h: 1.6, sill: 0.8, kind: 'window' },
    ],
    slots: {
      wall: [{ at: [4.12, 5.2], rot: W }, { at: [12.88, 3.6], rot: E }, { at: [4.12, 7.6], rot: W }, { at: [12.88, 7.6], rot: E }, { at: [4.12, 3.2], rot: W }],
      pedestal: [[6.6, 4.6], [10.4, 4.6], [6.6, 6.6], [10.4, 6.6], [8.5, 5.6]],
    },
  },
];

export const roomById = id => ROOMS.find(r => r.id === id);
export const DISPLAY_ROOMS = ROOMS.filter(r => !r.corridor);

/** 房间中心与尺寸 */
export function roomBox(room) {
  const [x0, z0, x1, z1] = room.rect;
  return { x0, z0, x1, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
}
