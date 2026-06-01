import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import TextInput from '../components/form/fields/TextInput';
import Checkbox from '../components/form/fields/Checkbox';
import { useForm, required } from '../components/form/useForm';
import ErrorNotice from '../components/feedback/ErrorNotice';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const form = useForm({
    username: '',
    password: '',
    trust_device: false
  });

  const onSubmit = async (values) => {
    setError('');
    setLoading(true);
    try {
      await login(values.username, values.password, values.trust_device);
      navigate('/dashboard');
    } catch (err) {
      setError(err.detail || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="layout" style={containerStyle}>
      <div className="card" style={cardStyle}>
        <h1 className="mt-0">Login</h1>
        <p className="text-muted" style={{ marginBottom: 24 }}>
          Enter your credentials to access your plants.
        </p>
        
        {error && <ErrorNotice message={error} />}
        
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <TextInput
            form={form}
            name="username"
            label="Username"
            placeholder="e.g. jdoe"
            validators={[required()]}
          />
          <div style={{ height: 16 }} />
          <TextInput
            form={form}
            name="password"
            label="Password"
            type="password"
            placeholder="••••••••"
            validators={[required()]}
          />
          <div style={{ height: 16 }} />
          <Checkbox
            form={form}
            name="trust_device"
            label="Trust this device"
          />
          <div style={{ height: 24 }} />
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={buttonStyle}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        
        <div style={{ marginTop: 24, textAlign: 'center', fontSize: 14 }}>
          <Link to="/" className="back-link" style={{ textDecoration: 'none' }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

const containerStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '100vh',
  background: 'var(--sidebar-bg)',
  padding: 16,
  boxSizing: 'border-box'
};

const cardStyle = {
  width: '100%',
  maxWidth: 400,
  padding: 32,
  borderRadius: 12,
  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  boxSizing: 'border-box'
};

const buttonStyle = {
  width: '100%',
  fontWeight: 600,
  fontSize: 16
};
