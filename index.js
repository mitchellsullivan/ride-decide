/**
 * @format
 */

import 'react-native-gesture-handler';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {YellowBox} from 'react-native';
YellowBox.ignoreWarnings(['AsyncStorage']);

console.ignoredYellowBox = ['AsyncStorage has '];
AppRegistry.registerComponent(appName, () => App);
