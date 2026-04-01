import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useAuth } from "./context/AuthContext";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AmbulanceDashboard } from "./pages/AmbulanceDashboard";
import { AmbulanceRegister } from "./pages/AmbulanceRegister";
import { HospitalDashboard } from "./pages/HospitalDashboard";
import { HospitalRegister } from "./pages/HospitalRegister";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { PatientRequest } from "./pages/PatientRequest";

function RequireRole({
  role,
  children,
}: {
  role: "admin" | "hospital" | "ambulance";
  children: ReactNode;
}) {
  const { token, role: r } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  if (r !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/request" element={<PatientRequest />} />
        <Route path="/register/hospital" element={<HospitalRegister />} />
        <Route path="/register/ambulance" element={<AmbulanceRegister />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/admin"
          element={
            <RequireRole role="admin">
              <AdminDashboard />
            </RequireRole>
          }
        />
        <Route
          path="/hospital"
          element={
            <RequireRole role="hospital">
              <HospitalDashboard />
            </RequireRole>
          }
        />
        <Route
          path="/ambulance"
          element={
            <RequireRole role="ambulance">
              <AmbulanceDashboard />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
