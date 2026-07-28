const path = require('path');
const CamundaModelerWebpackPlugin = require('camunda-modeler-webpack-plugin');

module.exports = {
  entry: './client/client.ts',
  output: {
    path: path.resolve(__dirname, 'client', 'dist'),
    filename: 'client.js'
  },
  module: {
    // elk.bundled.js is a large GWT-compiled file — skip full AST parsing for speed
    noParse: /elk\.bundled\.js$/,
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'tsconfig.client.json')
          }
        },
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      // elkjs main.js optionally requires 'web-worker' (a Node.js dependency).
      // In the browser/Electron renderer we use the self-contained bundled build
      // which has no external dependencies. The $ suffix means exact match only,
      // so 'elkjs' resolves here but 'elkjs/lib/...' still resolves normally.
      'elkjs$': path.resolve(__dirname, 'node_modules/elkjs/lib/elk.bundled.js')
    }
  },
  externals: {
    electron: 'commonjs2 electron'
  },
  plugins: [
    new CamundaModelerWebpackPlugin()
  ]
};
