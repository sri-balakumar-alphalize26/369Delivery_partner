// The app's entry: expo-router as before, plus the home-screen widget's task,
// which Android runs to draw the widget even when the app is closed
// (src/widget/widgetTask.ts). Does nothing in Expo Go.
import 'expo-router/entry';
import { registerWidgetTask } from './src/widget/widgetTask';

registerWidgetTask();
