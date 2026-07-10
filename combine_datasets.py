import json
import os
import shutil


def combine_json_datasets():
	# 1. Find all JSON dataset files in the current directory
	all_files = [
		f
		for f in os.listdir('.')
		if f.startswith('checkers_dataset') and f.endswith('.json')
	]

	# Exclude any existing combined files so we don't duplicate data if run multiple times
	raw_files = [f for f in all_files if '_combined_' not in f]

	if not raw_files:
		print("No raw 'checkers_dataset_*.json' files found to combine!")
		return

	print(f"Found {len(raw_files)} dataset files to combine:")
	combined_data = []

	# 2. Read and merge each file
	for filepath in sorted(raw_files):
		print(f"  -> Reading {filepath}...")
		with open(filepath, 'r') as f:
			data = json.load(f)
			combined_data.extend(data)

	total_positions = len(combined_data)
	print(
		f"\nSuccessfully merged {len(raw_files)} files into"
		f" {total_positions} total positions!"
	)

	# 3. Save the master combined dataset
	output_filename = (
		f"checkers_dataset_combined_{total_positions}_positions.json"
	)
	print(f"Saving combined dataset to: {output_filename}...")

	with open(output_filename, 'w') as f:
		json.dump(combined_data, f)

	# 4. Move old batch files to an archive folder to keep the workspace clean
	archive_dir = "archived_raw_datasets"
	os.makedirs(archive_dir, exist_ok=True)

	for filepath in raw_files:
		shutil.move(filepath, os.path.join(archive_dir, filepath))
	print(
		f"Moved {len(raw_files)} raw files to './{archive_dir}/' to prevent"
		" re-merging later."
	)

	print(
		f"\nDone! '{output_filename}' now has the newest timestamp."
	)
	print(
		"You can now run 'python train_export.py' and it will automatically use"
		" this combined dataset!"
	)


if __name__ == '__main__':
	combine_json_datasets()