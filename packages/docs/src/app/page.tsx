import type { Metadata } from 'next';
import { LandingPage } from '../components/landing';
import './landing.css';

export const metadata: Metadata = {
  title: 'Node Flow — make complex workflows flow',
  description: 'Workflow orchestration you can read. Build durable workflows with declarative JSON, workers in any language, and Postgres as your only infrastructure dependency.',
};

export default function Home() {
  return <LandingPage />;
}
