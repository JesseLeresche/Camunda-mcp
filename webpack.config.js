const path = require('path');
const CamundaModelerWebpackPlugin = require('camunda-modeler-webpack-plugin');

module.exports = {
  entry: './client/client.ts',
  output: {
    path: path.resolve(__dirname, 'client', 'dist'),
    filename: 'client.js'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: {
          loader: 'ts-loader',
          options: {
            configFile: path.resolve(__dirname, 'client', 'tsconfig.json')
          }
        },
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  externals: {
    electron: 'commonjs2 electron'
  },
  plugins: [
    new CamundaModelerWebpackPlugin()
  ]
};
