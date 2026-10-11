// Lets plain node import app/src/lib/*.ts, whose relative imports omit the .ts extension (Next.js style).
//   node --import ./benchmarks/law-retrieval/resolve-ts.mjs <script.ts>
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(specifier + ".ts", context);
      throw err;
    }
  },
});
