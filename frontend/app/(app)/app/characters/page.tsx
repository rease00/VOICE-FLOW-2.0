import { redirect } from 'next/navigation';

const LegacyCharactersRoutePage = (): never => {
  redirect('/app/voices');
};

export default LegacyCharactersRoutePage;
