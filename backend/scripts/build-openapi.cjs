const fs = require('node:fs');
const path = require('node:path');
const { swaggerSpec } = require('../dist/utils/swagger');

if (Object.keys(swaggerSpec.paths || {}).length < 50) {
  throw new Error('OpenAPI route annotations were not included in the build');
}
fs.writeFileSync(path.join(__dirname, '../dist/openapi.json'), JSON.stringify(swaggerSpec));
