
import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Camera } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-lg p-6">
        <div className="space-y-6">
          {/* Área do preview da câmera */}
          <div className="aspect-[4/3] bg-gray-200 rounded-lg overflow-hidden">
            <div id="qr-reader" className="w-full h-full"></div>
          </div>
          
          {/* Input para o número */}
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Digite o número do código QR"
              className="w-full border-2 border-gray-300"
            />
          </div>

          {/* Botões de ação */}
          <div className="space-y-3">
            <Button 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg flex items-center justify-center gap-2"
            >
              <Camera className="w-5 h-5" />
              Iniciar Scanner
            </Button>
            
            <Button 
              variant="outline"
              className="w-full border-2 border-gray-300 py-3 rounded-lg"
            >
              Download Fotos
            </Button>
          </div>

          {/* Contador de fotos */}
          <div className="text-center text-gray-600">
            Fotos capturadas: 0
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
