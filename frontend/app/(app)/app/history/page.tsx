import { redirect } from 'next/navigation';

const LegacyHistoryRoutePage = (): never => {
  redirect('/app/runs');
};

export default LegacyHistoryRoutePage;
