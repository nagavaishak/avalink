const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

// Polyfills for ethers.js / crypto in React Native
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  buffer: require.resolve('buffer'),
  crypto: require.resolve('react-native-get-random-values'),
  stream: require.resolve('stream-browserify'),
}

module.exports = withNativeWind(config, { input: './global.css' })
