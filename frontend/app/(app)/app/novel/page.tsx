import { redirect } from 'next/navigation';

const LegacyNovelRoutePage = (): never => {
  redirect('/app/writing');
};

export default LegacyNovelRoutePage;
