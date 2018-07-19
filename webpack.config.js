const path = require('path');
const slsw = require('serverless-webpack');
const webpack = require('webpack')
// const nodeExternals = require('webpack-node-externals');

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
    ]
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
    noParse: [/^websocket$/]
  },
  plugins: [
    new webpack.IgnorePlugin(/scrypt/),
    new webpack.IgnorePlugin(/electron/)
  ],
  externals: ['websocket']
  // externals: [ nodeExternals() ],
};
