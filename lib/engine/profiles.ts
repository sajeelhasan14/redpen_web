import type { Profile } from './types';

/** The one profile December ships: AP-style marking. */
export const AP_DEFAULT: Profile = {
  id: 'ap-default',
  followThrough: true,
  plusC: { penalty: 1, scope: 'exam' },
  exactForm: true,
};
