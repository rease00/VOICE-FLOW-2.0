import { redirect } from 'next/navigation';

const LegacyVoiceCloningRoutePage = (): never => {
  redirect('/app/voices');
};

export default LegacyVoiceCloningRoutePage;
