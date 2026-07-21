/**
 * pi-lark-hub 的包根扩展入口。
 *
 * Pi 的扩展列表对入口文件名为 index.ts/index.js 时会显示包名/父目录名，
 * 因此包根使用 index.ts 可显示为 pi-lark-hub（无 .ts 后缀）。
 * 实际逻辑仍 re-export ./src/index.js → lark-bridge。
 */
export { default } from "./src/index.js";
