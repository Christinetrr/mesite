import { ShaderGradientCanvas, ShaderGradient } from "@shadergradient/react";
import "./App.css";
import CursorRipple from "./components/cursorRipple";
function App() {
  return (
    <>
      {/* Background layer: fixed behind everything */}
      <div className="gradient-bg">
        <ShaderGradientCanvas>
          <ShaderGradient
            control="query"
            urlString="https://shadergradient.co/customize?animate=on&axesHelper=off&brightness=1&cAzimuthAngle=180&cDistance=2.19&cPolarAngle=90&cameraZoom=1&color1=%23ff8faf&color2=%23c1a9db&color3=%236565d7&destination=onCanvas&embedMode=off&envPreset=city&format=gif&fov=45&frameRate=10&gizmoHelper=hide&grain=on&lightType=3d&pixelDensity=1.2&positionX=-1.4&positionY=0&positionZ=0&range=disabled&rangeEnd=34.1&rangeStart=0&reflection=0.1&rotationX=0&rotationY=10&rotationZ=50&shader=defaults&type=waterPlane&uAmplitude=1&uDensity=0.8&uFrequency=5.5&uSpeed=0.3&uStrength=2.4&uTime=0&wireframe=false"
          />
          <CursorRipple />
        </ShaderGradientCanvas>
      </div>
      {/* Content layer: sits on top */}
      <main className="content">
        <section className="intro">
          <h1>Heyo I'm Christine!</h1>
          <p>professional daydreamer · developer · life enthusiast</p>
        </section>
      </main>
    </>
  );
}

export default App;
