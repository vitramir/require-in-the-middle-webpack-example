const path = require("path");
const parse = require("module-details-from-path");
const resolve = require("resolve");
const Module = require("module");

const projectRoot = __dirname; //path.resolve(__dirname, "dist");

/**
 * begin code from require-in-the-middle
 */
const builtins = Module.builtinModules;
const isCore = builtins
  ? (filename) => builtins.includes(filename)
  : // Fallback in case `builtins` isn't available in the current Node.js
    // version. This isn't as acurate, as some core modules contain slashes, but
    // all modern versions of Node.js supports `buildins`, so it shouldn't affect
    // many people.
    (filename) => filename.includes(path.sep) === false;

/**
 * end code from require-in-the-middle
 */

module.exports = {
  mode: "none",
  entry: "./lib/index.js",
  target: "node",
  node: false,
  optimization: {
    moduleIds: false, //"named",
  },
  output: {
    path: path.resolve(__dirname, "./dist"),
    filename: "index.js",
    publicPath: "/assets/",
  },
  plugins: [
    {
      apply(compiler) {
        compiler.hooks.compilation.tap("RequireInTheMiddle", (compilation) => {
          const modulesMap = new Map();

          /**
           * Prepare modulesMap.
           * Store filename and mainModuleFilename
           * because require-in-the-middle can't resolve main module's filepath in runtime.
           */
          compilation.hooks.afterOptimizeModuleIds.tap(
            "RequireInTheMiddle",
            (modules) => {
              modules.forEach((m) => {
                let filename = m.resource || m.request;
                let mainModuleFilename = null;

                // this part is similar to require-in-the-middle
                const core = isCore(filename);
                if (!core && filename) {
                  const stat = parse(filename);
                  if (stat) {
                    const moduleName = stat.name;
                    const basedir = stat.basedir;
                    mainModuleFilename = resolve.sync(moduleName, {
                      basedir,
                    });

                    filename = path.relative(projectRoot, filename);
                    mainModuleFilename = path.relative(
                      projectRoot,
                      mainModuleFilename
                    );
                  }
                }

                modulesMap.set(m.id, { filename, mainModuleFilename });
              });
              return modules;
            }
          );

          /**
           * Update Webpack runtime code.
           * 1. Make __webpack_require__ to call implementation from variable.
           * 2. Set modulesMap to let require-in-the-middle find package name by id.
           */
          compilation.mainTemplate.hooks.beforeStartup.tap(
            "RequireInTheMiddle",
            (source, chunk, hash) => {
              const buf = [];

              // move to implementation
              buf.push(`const __webpack_require_impl__ = __webpack_require__;`);
              buf.push(`__webpack_require__ = function (moduleId) {`);
              buf.push(`    return __webpack_require__.impl(moduleId);`);
              buf.push(`}`);
              buf.push(
                `Object.assign(__webpack_require__, __webpack_require_impl__);`
              );
              buf.push(`__webpack_require__.impl = __webpack_require_impl__;`);

              // set modulesMap
              buf.push(
                `__webpack_require__.modulesMap = new Map(${JSON.stringify(
                  Array.from(modulesMap.entries()),
                  null,
                  2
                )});`
              );
              return buf;
            }
          );

          /* update source of require-in-the-middle */
          compilation.hooks.succeedModule.tap("RequireInTheMiddle", (m) => {
            if (
              m.resource &&
              m.resource.includes("require-in-the-middle/index.js")
            ) {
              // replace Module.prototype.require with __webpack_require__.impl
              m._source._value = m._source._value.replace(
                /Module\.prototype\.require/g,
                "__webpack_require__.impl"
              );

              // restore filename, mainModuleFilename from modulesMap
              m._source._value = m._source._value.replace(
                `if (self._unhooked === true) {`,
                `const { filename, mainModuleFilename } = __webpack_require__.modulesMap.get(id);
                if (self._unhooked === true) {`
              );

              /**
               * Remove Module._resolveFilename, because we already have filename
               * and it is impossible to resolve it in runtime (no node_modules)
               */
              m._source._value = m._source._value.replace(
                `const filename = Module._resolveFilename(id, this)`,
                ``
              );

              /**
               * Remove resolve.sync, because we already have mainModuleFilename
               * and it is impossible to resolve it in runtime (no node_modules)
               *
               * TODO: We are losing try-catch here, but it should appear in prepare modulesMap section
               */
              m._source._value = m._source._value.replace(
                `        let res
        try {
          res = resolve.sync(moduleName, { basedir })
        } catch (e) {
          debug('could not resolve module: %s', moduleName)
          return exports // abort if module could not be resolved (e.g. no main in package.json and no index.js file)
        }`,
                ``
              );

              // replace res with mainModuleFilename (see previous step)
              m._source._value = m._source._value.replace(
                `if (res !== filename)`,
                `if (mainModuleFilename !== filename)`
              );
              m._source._value = m._source._value.replace(
                `debug('ignoring require of non-main module file: %s', res)`,
                `debug('ignoring require of non-main module file: %s', mainModuleFilename)`
              );
            }
          });
        });
      },
    },
  ],
};
