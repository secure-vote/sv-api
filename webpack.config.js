const path = require('path');
const slsw = require('serverless-webpack');
const webpack = require('webpack')
const nodeExternals = require('webpack-node-externals');

const entries = {};

Object.keys(slsw.lib.entries).forEach(key => (
  entries[key] = ['./source-map-install.js', slsw.lib.entries[key]]
));

module.exports = {
  entry: entries,
  devtool: 'source-map',
  resolve: {
    extensions: [
      '.js',
      '.jsx',
      '.json',
      '.ts',
      '.tsx'
    ],
    alias: {
      'scrypt.js': path.resolve('./node_modules/scrypt.js/js.js'),
      // 'swarm-js': path.resolve(__dirname, '../node_modules/swarm-js/lib/api-browser.js'),
      // 'fs': path.resolve(__dirname, '../src/app/fs-fake.js'),
    },
    modules: [path.resolve('./node_modules')],
  },
  output: {
    libraryTarget: 'commonjs',
    path: path.join(__dirname, '.webpack'),
    filename: '[name].js',
  },
  target: 'node',
  module: {
    loaders: [
      { test: /\.ts(x?)$/, loader: 'ts-loader' },
    ],
    // noParse: [/^websocket$/]
  },
  plugins: [
    new webpack.IgnorePlugin(/electron/),
    // new webpack.IgnorePlugin(/scrypt/),
  ],
  externals: [
    // 'scrypt',
    nodeExternals(),
  ]
};
