const fs = require("fs");
const source = fs.readFileSync(require.resolve("./image-upload-bootstrap.js"), "utf8").replace(/\/image-upload-ui\.js\?v=401/g, "/image-upload-ui-v2.js?v=402");
eval(source);
