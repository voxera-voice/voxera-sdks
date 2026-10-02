// Every method the JS side calls must exist on both native modules.
//
// React Native only sees a Swift method through its RCT_EXTERN_METHOD line in
// VoxeraModule.m. Forget that line and the Swift compiles, the JS type-checks,
// and the call is undefined at runtime on iOS alone — which is how 2.2.0
// shipped selectAction. Nothing but a device run would notice, so check here.
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [spec, objc, swift, kotlin] = await Promise.all([
  read("src/NativeVoxeraModule.ts"),
  read("ios/VoxeraModule.m"),
  read("ios/VoxeraModule.swift"),
  read("android/src/main/java/com/voxera/reactnative/VoxeraModule.kt"),
]);

// Required by NativeEventEmitter; RCTEventEmitter and the Android base supply them.
const EMITTER_METHODS = new Set(["addListener", "removeListeners"]);

const iface = spec.match(/export interface NativeVoxeraModule \{([\s\S]*?)\n\}/);
if (!iface) throw new Error("NativeVoxeraModule interface not found");
const jsMethods = [...iface[1].matchAll(/^\s*(\w+)\(/gm)]
  .map((m) => m[1])
  .filter((name) => !EMITTER_METHODS.has(name));

// "selectAction:(NSString *)actionId result:(NSString *)result ..." -> "selectAction:result:..."
const objcSelectors = new Map(
  objc
    .split("RCT_EXTERN_METHOD(")
    .slice(1)
    .map((body) => {
      const labels = [...body.matchAll(/(\w+)\s*:\s*\(/g)].map((m) => m[1]);
      return [labels[0], labels.map((label) => `${label}:`).join("")];
    }),
);
const swiftSelectors = new Map(
  [...swift.matchAll(/@objc\((\w+):([\w:]*)\)/g)].map((m) => [m[1], `${m[1]}:${m[2]}`]),
);
const kotlinMethods = new Set(
  [...kotlin.matchAll(/@ReactMethod\s+fun\s+(\w+)/g)].map((m) => m[1]),
);

const problems = [];
for (const name of jsMethods) {
  const objcSelector = objcSelectors.get(name);
  const swiftSelector = swiftSelectors.get(name);
  if (!swiftSelector) problems.push(`iOS: ${name} has no @objc method in VoxeraModule.swift`);
  if (!objcSelector) problems.push(`iOS: ${name} has no RCT_EXTERN_METHOD in VoxeraModule.m`);
  else if (swiftSelector && objcSelector !== swiftSelector) {
    problems.push(`iOS: ${name} is exported as ${objcSelector} but Swift declares ${swiftSelector}`);
  }
  if (!kotlinMethods.has(name)) problems.push(`Android: ${name} has no @ReactMethod in VoxeraModule.kt`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Native bridge exports all ${jsMethods.length} methods on iOS and Android.`);
