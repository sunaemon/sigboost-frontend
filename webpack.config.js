const path = require('path');
const ExtractTextPlugin = require('extract-text-webpack-plugin');

module.exports = [{
    context: path.join(__dirname, 'src/stylesheets'),
    entry: {
        style: './style.scss'
    },
    output: {
        path: path.join(__dirname, 'public/stylesheets'),
        filename: 'style.css'
    },
    module: {
        loaders: [
            {
                test: /\.scss$/,
                loader: ExtractTextPlugin.extract({ fallback: 'style-loader', use: 'css-loader!resolve-url-loader!sass-loader?SourceMap' })
            },
            { test: /\.png$/, loader: 'url-loader' }
        ]
    },
    devtool: 'source-map',
    plugins: [
        new ExtractTextPlugin('style.css')
    ]
}];
