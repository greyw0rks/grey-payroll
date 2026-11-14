import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const jobs = cronJobs();
jobs.interval('Expire authentication and rate metadata', { hours: 1 }, internal.model.cleanup, {});
export default jobs;
