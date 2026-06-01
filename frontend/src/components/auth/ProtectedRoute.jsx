import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * ProtectedRoute component
 * 
 * Ensures that the wrapped component(s) are only accessible to authenticated users.
 * If the user is not authenticated, they are redirected to the login page.
 * The current location is preserved in the navigation state to allow redirecting back
 * after a successful login.
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Redirect to login page, preserving the intended destination
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // If children are provided, render them; otherwise render the Outlet for nested routes
  return children ? children : <Outlet />;
};

export default ProtectedRoute;
