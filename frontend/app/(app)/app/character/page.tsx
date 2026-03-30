import { redirect } from 'next/navigation';

const LegacyCharacterRoutePage = (): never => {
  redirect('/app/voices');
};

export default LegacyCharacterRoutePage;
