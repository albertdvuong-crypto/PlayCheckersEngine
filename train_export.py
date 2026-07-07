import json
import os
import time
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader

# --- 1. LIGHTWEIGHT ARCHITECTURE (OPTIMIZED FOR 4GB VRAM & WASM INFERENCE) ---
class CheckersValueNet(nn.Module):
    def __init__(self):
        super(CheckersValueNet, self).__init__()
        # Input: 4 channels x 32 squares = 128 features
        self.net = nn.Sequential(
            nn.Flatten(),
            nn.Linear(128, 256),
            nn.LeakyReLU(0.1),
            nn.BatchNorm1d(256),
            nn.Dropout(0.2),
            
            nn.Linear(256, 128),
            nn.LeakyReLU(0.1),
            nn.BatchNorm1d(128),
            nn.Dropout(0.2),
            
            nn.Linear(128, 64),
            nn.LeakyReLU(0.1),
            
            nn.Linear(64, 1),
            nn.Tanh()  # Bounds evaluation between -1.0 (P2 win) and +1.0 (P1 win)
        )

    def forward(self, x):
        return self.net(x)

# --- 2. VECTORIZED DATASET LOADER ---
class CheckersDataset(Dataset):
    def __init__(self, json_filepath):
        print(f"Loading dataset from {json_filepath}...")
        with open(json_filepath, 'r') as f:
            raw_data = json.load(f)
            
        print(f"Vectorizing {len(raw_data)} positions into 4-channel tensors...")
        self.states = np.zeros((len(raw_data), 4, 32), dtype=np.float32)
        self.outcomes = np.zeros((len(raw_data), 1), dtype=np.float32)
        
        for idx, item in enumerate(raw_data):
            state_32 = item['state']
            self.outcomes[idx, 0] = item['outcome']
            
            for sq_idx, piece in enumerate(state_32):
                if piece == 1:   self.states[idx, 0, sq_idx] = 1.0  # P1 Normal
                elif piece == 3: self.states[idx, 1, sq_idx] = 1.0  # P1 King
                elif piece == 2: self.states[idx, 2, sq_idx] = 1.0  # P2 Normal
                elif piece == 4: self.states[idx, 3, sq_idx] = 1.0  # P2 King

    def __len__(self):
        return len(self.outcomes)

    def __getitem__(self, idx):
        return torch.tensor(self.states[idx]), torch.tensor(self.outcomes[idx])

# --- 3. TRAINING & EXPORT PIPELINE ---
def train_and_export():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using compute device: {device} (NVIDIA Quadro P1000 Expected)")

    # Find dataset file automatically
    dataset_files = [f for f in os.listdir('.') if f.startswith('checkers_dataset') and f.endswith('.json')]
    if not dataset_files:
        raise FileNotFoundError("No 'checkers_dataset_*.json' found in current directory!")
    
    dataset_path = dataset_files[0]
    dataset = CheckersDataset(dataset_path)
    
    # 512 batch size utilizes <500MB VRAM, leaving plenty of headroom
    dataloader = DataLoader(dataset, batch_size=512, shuffle=True, num_workers=2, pin_memory=True)

    model = CheckersValueNet().to(device)
    criterion = nn.MSELoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode='min', factor=0.5, patience=2)

    epochs = 15
    print(f"\nStarting GPU Training for {epochs} Epochs...")
    start_time = time.time()

    for epoch in range(epochs):
        model.train()
        total_loss = 0.0
        
        for batch_states, batch_outcomes in dataloader:
            batch_states = batch_states.to(device, non_blocking=True)
            batch_outcomes = batch_outcomes.to(device, non_blocking=True)

            optimizer.zero_grad()
            predictions = model(batch_states)
            loss = criterion(predictions, batch_outcomes)
            loss.backward()
            optimizer.step()

            total_loss += loss.item() * batch_states.size(0)

        avg_loss = total_loss / len(dataset)
        scheduler.step(avg_loss)
        print(f"Epoch [{epoch+1:02d}/{epochs:02d}] - MSE Loss: {avg_loss:.6f} - LR: {optimizer.param_groups[0]['lr']:.6f}")

    print(f"\nTraining completed in {(time.time() - start_time):.2f} seconds!")

    # --- 4. ONNX EXPORT ---
    print("\nExporting trained weights to ONNX format...")
    model.eval()
    
    # Create dummy tensor matching shape (Batch Size=1, Channels=4, Squares=32)
    dummy_input = torch.randn(1, 4, 32, device=device)
    onnx_filename = "checkers_valuenet.onnx"
    
    torch.onnx.export(
        model,
        dummy_input,
        onnx_filename,
        export_params=True,
        opset_version=14,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={
            'input': {0: 'batch_size'},
            'output': {0: 'batch_size'}
        }
    )
    print(f"Model successfully saved to: {os.path.abspath(onnx_filename)}")
    print("Ready for browser deployment!")

if __name__ == "__main__":
    train_and_export()