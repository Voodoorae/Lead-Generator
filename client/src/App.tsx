import { useMemo, useState } from "react";
import GeoHeatmap from "./pages/GeoHeatmap";
import LeadGen from "./pages/LeadGen";

export default function App() {
  const [path] = useState(window.location.pathname);

  const page = useMemo(() => {
    if (path === "/lead-gen" || path === "/lead-gen/") return <LeadGen />;
    return <GeoHeatmap />;
  }, [path]);

  return page;
}
