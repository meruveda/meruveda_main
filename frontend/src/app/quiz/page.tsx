export default function QuizPage() {
  return (
    <div className="container mx-auto px-6 py-24 min-h-[60vh] text-center">
      <h1 className="text-4xl md:text-5xl font-playfair font-bold text-deep-purple mb-8">Discover Your Dosha</h1>
      <p className="text-lg text-gray-600 max-w-2xl mx-auto mb-12">
        Answer a few simple questions about your physical traits and tendencies to uncover your unique Ayurvedic constitution (Prakriti).
      </p>
      <div className="bg-white p-12 rounded-xl shadow-sm border border-gray-100 max-w-3xl mx-auto">
        <h2 className="text-2xl font-playfair font-bold text-deep-purple mb-6">Question 1 of 10</h2>
        <p className="text-lg mb-8">How would you describe your body frame?</p>
        <div className="flex flex-col gap-4 max-w-md mx-auto">
          <button className="border border-gray-300 rounded py-3 hover:border-gold hover:text-gold transition-colors">Thin and slender (hard to gain weight)</button>
          <button className="border border-gray-300 rounded py-3 hover:border-gold hover:text-gold transition-colors">Medium and athletic (gains and loses weight easily)</button>
          <button className="border border-gray-300 rounded py-3 hover:border-gold hover:text-gold transition-colors">Broad and solid (gains weight easily)</button>
        </div>
      </div>
    </div>
  );
}
