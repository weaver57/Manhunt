// The location task must be registered before anything else - background
// wake-ups execute this bundle and the task manager resolves executors by
// registration order.
import './src/lib/location/locationEngine';
import 'expo-router/entry';
