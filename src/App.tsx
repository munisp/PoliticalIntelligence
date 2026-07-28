import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import Opportunities from "./pages/Opportunities";
import Legislation from "./pages/Legislation";
import Simulation from "./pages/Simulation";
import Briefs from "./pages/Briefs";
import DataHealth from "./pages/DataHealth";
import Copilot from "./pages/Copilot";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import InnovationsRouter from "./pages/innovations";
import Geo3D from "./pages/Geo3D";
import Advocacy from "./pages/Advocacy";

export default function App() {
  return (
    <Routes>
      {/* Public landing — its own minimal chrome, NOT the app Layout */}
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      {/* App shell — nested routes render into Layout's <Outlet/> */}
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/opportunities" element={<Opportunities />} />
        <Route path="/legislation" element={<Legislation />} />
        <Route path="/simulation" element={<Simulation />} />
        <Route path="/briefs" element={<Briefs />} />
        <Route path="/data-health" element={<DataHealth />} />
        <Route path="/copilot" element={<Copilot />} />
        <Route path="/advocacy" element={<Advocacy />} />
        {/* GEO3D-ROUTE */}
        <Route path="/geo3d" element={<Geo3D />} />
        {/* INNOVATIONS-ROUTE */}
        <Route path="/innovations/*" element={<InnovationsRouter />} />
        {/* Secondary-nav destinations (stubbed) */}
        <Route path="/documents" element={<Briefs />} />
        <Route path="/audit-log" element={<DataHealth />} />
        <Route path="/settings" element={<Dashboard />} />
        <Route path="/help" element={<Dashboard />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
