import { redirect } from 'next/navigation';
import { currentUser } from '../lib/api';

/**
 * The root sends you where you can actually work.
 *
 * The overview: whether anything needs attention, with every figure a link to
 * the screen that acts on it — so even someone after one specific run is a
 * click away, and someone who is not learns something first.
 */
export default async function Home() {
  redirect((await currentUser()) ? '/overview' : '/login');
}
