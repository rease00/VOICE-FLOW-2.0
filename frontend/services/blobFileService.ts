export const blobUrlToFile = async (url: string, filename: string, type: string): Promise<File> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type });
};
