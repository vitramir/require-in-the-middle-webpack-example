import path from "path";
import Hook from "require-in-the-middle";

// Hook into the express module
Hook(["express"], { internals: true }, function (exports, name, basedir) {
  console.log("loading %s", name);

  // whatever you return will be returned by `require`
  return exports;
});
