import { registerRootComponent } from "expo";
import DemoApp from "./src/DemoApp";
import ServerApp from "./src/ServerApp";
import "./src/liquid-glass.css";
registerRootComponent(process.env.EXPO_PUBLIC_DEMO_MODE === "1" ? DemoApp : ServerApp);
