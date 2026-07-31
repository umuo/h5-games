import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUTPUT = resolve("games/line-connect/src/levels.json");
const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const NAMES = [
  "平行起步",
  "纵向练习",
  "第一次转弯",
  "四角回路",
  "错位端点",
  "环形入门",
  "五色通道",
  "交错之间",
  "外圈内圈",
  "曲折前行",
  "中心交换",
  "满格挑战",
  "六色分流",
  "窄路相逢",
  "回旋棋盘",
  "左右穿梭",
  "层层深入",
  "路线规划",
  "七色迷阵",
  "边缘折返",
  "中心风暴",
  "长路相连",
  "一步不让",
  "连线大师",
];

const SPECS = [
  { size: 4, pattern: "rows", lengths: [4, 4, 4, 4] },
  { size: 4, pattern: "columns", lengths: [4, 4, 4, 4], transform: 0 },
  { size: 4, pattern: "spiral", lengths: [3, 4, 4, 5] },
  { size: 4, pattern: "random", lengths: [3, 3, 5, 5] },
  { size: 4, pattern: "random", lengths: [2, 4, 4, 6] },
  { size: 4, pattern: "spiral", lengths: [2, 3, 5, 6], transform: 3 },
  { size: 5, pattern: "rows", lengths: [5, 5, 5, 5, 5] },
  { size: 5, pattern: "random", lengths: [4, 4, 5, 6, 6] },
  { size: 5, pattern: "spiral", lengths: [4, 5, 5, 5, 6], transform: 1 },
  { size: 5, pattern: "random", lengths: [3, 4, 5, 6, 7] },
  { size: 5, pattern: "columns", lengths: [5, 6, 7, 7], transform: 2 },
  { size: 5, pattern: "random", lengths: [3, 5, 5, 6, 6] },
  { size: 6, pattern: "rows", lengths: [6, 6, 6, 6, 6, 6] },
  { size: 6, pattern: "random", lengths: [4, 5, 6, 6, 7, 8] },
  { size: 6, pattern: "spiral", lengths: [5, 5, 6, 6, 7, 7], transform: 1 },
  { size: 6, pattern: "random", lengths: [3, 5, 6, 7, 7, 8] },
  { size: 6, pattern: "columns", lengths: [4, 5, 6, 6, 7, 8], transform: 3 },
  { size: 6, pattern: "random", lengths: [4, 5, 5, 6, 7, 9] },
  { size: 7, pattern: "rows", lengths: [7, 7, 7, 7, 7, 7, 7] },
  { size: 7, pattern: "random", lengths: [5, 6, 7, 7, 8, 8, 8] },
  { size: 7, pattern: "spiral", lengths: [5, 6, 7, 7, 8, 8, 8], transform: 2 },
  { size: 7, pattern: "random", lengths: [4, 6, 7, 7, 8, 8, 9] },
  { size: 7, pattern: "columns", lengths: [5, 6, 6, 7, 8, 8, 9], transform: 1 },
  { size: 7, pattern: "random", lengths: [4, 5, 7, 7, 8, 9, 9] },
];

function key(point) {
  return `${point.x},${point.y}`;
}

function mulberry32(seed) {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function rowSnake(size) {
  const points = [];
  for (let y = 0; y < size; y += 1) {
    const columns = Array.from({ length: size }, (_, index) => index);
    if (y % 2 === 1) columns.reverse();
    columns.forEach((x) => points.push({ x, y }));
  }
  return points;
}

function columnSnake(size) {
  return rowSnake(size).map((point) => ({ x: point.y, y: point.x }));
}

function spiral(size) {
  const points = [];
  let left = 0;
  let right = size - 1;
  let top = 0;
  let bottom = size - 1;
  while (left <= right && top <= bottom) {
    for (let x = left; x <= right; x += 1) points.push({ x, y: top });
    top += 1;
    for (let y = top; y <= bottom; y += 1) points.push({ x: right, y });
    right -= 1;
    if (top <= bottom) {
      for (let x = right; x >= left; x -= 1) points.push({ x, y: bottom });
      bottom -= 1;
    }
    if (left <= right) {
      for (let y = bottom; y >= top; y -= 1) points.push({ x: left, y });
      left += 1;
    }
  }
  return points;
}

function transformOrder(points, size, transform = 0) {
  return points.map((point) => {
    switch (transform % 4) {
      case 1:
        return { x: size - 1 - point.y, y: point.x };
      case 2:
        return { x: size - 1 - point.x, y: size - 1 - point.y };
      case 3:
        return { x: point.y, y: size - 1 - point.x };
      default:
        return { ...point };
    }
  });
}

function randomHamiltonian(size, seed) {
  const random = mulberry32(seed);
  const total = size * size;
  const starts = shuffle(
    [
      { x: 0, y: 0 },
      { x: size - 1, y: 0 },
      { x: size - 1, y: size - 1 },
      { x: 0, y: size - 1 },
    ],
    random,
  );

  for (const start of starts) {
    const visited = new Set([key(start)]);
    const path = [{ ...start }];
    let explored = 0;

    function search(current) {
      explored += 1;
      if (path.length === total) return true;
      if (explored > 350000) return false;

      const candidates = shuffle(
        DIRECTIONS
          .map((direction) => ({
            x: current.x + direction.x,
            y: current.y + direction.y,
          }))
          .filter((point) => (
            point.x >= 0 &&
            point.x < size &&
            point.y >= 0 &&
            point.y < size &&
            !visited.has(key(point))
          )),
        random,
      ).sort((a, b) => {
        const onward = (point) => DIRECTIONS.filter((direction) => {
          const next = { x: point.x + direction.x, y: point.y + direction.y };
          return (
            next.x >= 0 &&
            next.x < size &&
            next.y >= 0 &&
            next.y < size &&
            !visited.has(key(next))
          );
        }).length;
        return onward(a) - onward(b);
      });

      for (const candidate of candidates) {
        visited.add(key(candidate));
        path.push(candidate);
        if (search(candidate)) return true;
        path.pop();
        visited.delete(key(candidate));
      }
      return false;
    }

    if (search(start)) return path;
  }
  return transformOrder(spiral(size), size, seed % 4);
}

function validateOrder(order, size) {
  if (order.length !== size * size) throw new Error("Order does not cover the board");
  if (new Set(order.map(key)).size !== order.length) throw new Error("Order repeats a cell");
  order.forEach((point, index) => {
    if (point.x < 0 || point.x >= size || point.y < 0 || point.y >= size) {
      throw new Error("Order leaves the board");
    }
    if (index > 0) {
      const previous = order[index - 1];
      if (Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) !== 1) {
        throw new Error("Order contains a disconnected step");
      }
    }
  });
}

function createLevel(spec, index) {
  const sum = spec.lengths.reduce((total, length) => total + length, 0);
  if (sum !== spec.size * spec.size || spec.lengths.some((length) => length < 2)) {
    throw new Error(`Invalid partitions for level ${index + 1}`);
  }

  let order;
  if (spec.pattern === "rows") order = rowSnake(spec.size);
  else if (spec.pattern === "columns") order = columnSnake(spec.size);
  else if (spec.pattern === "spiral") order = spiral(spec.size);
  else order = randomHamiltonian(spec.size, 0xc0ffee + index * 1777);
  order = transformOrder(order, spec.size, spec.transform ?? index % 4);
  validateOrder(order, spec.size);

  const paths = [];
  let cursor = 0;
  for (const length of spec.lengths) {
    paths.push(order.slice(cursor, cursor + length));
    cursor += length;
  }

  return {
    id: index + 1,
    name: NAMES[index],
    difficulty: index < 6 ? "入门" : index < 12 ? "简单" : index < 18 ? "进阶" : "挑战",
    size: spec.size,
    pairs: paths.map((path, color) => ({
      color,
      start: path[0],
      end: path[path.length - 1],
    })),
    solution: paths,
  };
}

const levels = SPECS.map(createLevel);
await mkdir(resolve("games/line-connect/src"), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(levels, null, 2)}\n`, "utf8");
console.log(`Generated and verified ${levels.length} line-connect levels at ${OUTPUT}`);
