import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../lib/api';
import { QuestionWording } from '../QuestionWording';

vi.mock('../../lib/api', () => ({ api: { updateWorkspaceSettings: vi.fn(async () => ({})) } }));
const values = { option: 'Kb2', workspace: 'Chess', metric: 'game score', date: 'when the game ends' };
const props = { workspaceId: 'ws-chess', canManage: true, value: null, values, onSaved: vi.fn() };
beforeEach(() => vi.clearAllMocks());
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit question wording' }));
}
test('only managers can edit workspace wording', () => {
  render(<QuestionWording {...props} canManage={false} />);
  expect(screen.queryByRole('button')).toBeNull();
});
test('previews and saves the whole workspace template through the settings API', async () => {
  render(<QuestionWording {...props} />);
  open();
  fireEvent.change(screen.getByLabelText('Workspace question wording'), {
    target: { value: 'If {option}, what is {workspace} doing {date}?' },
  });
  expect(screen.getByText('If Kb2, what is Chess doing when the game ends?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(api.updateWorkspaceSettings).toHaveBeenCalledWith('ws-chess', {
    optionQuestionTemplate: 'If {option}, what is {workspace} doing {date}?',
  });
});
test('empty wording restores the default', async () => {
  render(<QuestionWording {...props} value="Choose {option}" />);
  open();
  fireEvent.change(screen.getByLabelText('Workspace question wording'), { target: { value: '  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenCalledWith('ws-chess', { optionQuestionTemplate: null }),
  );
});
test('cancel does not save', () => {
  render(<QuestionWording {...props} />);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Workspace question wording')).toBeNull();
});
test('a failed save retains the draft and displays the error', async () => {
  vi.mocked(api.updateWorkspaceSettings).mockRejectedValueOnce(new Error('Use {option}.'));
  render(<QuestionWording {...props} />);
  open();
  fireEvent.change(screen.getByLabelText('Workspace question wording'), { target: { value: 'Bad words' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save wording' }));
  await screen.findByText('Use {option}.');
  expect((screen.getByLabelText('Workspace question wording') as HTMLTextAreaElement).value).toBe('Bad words');
  expect(props.onSaved).not.toHaveBeenCalled();
});
test('option values and templates are rendered as plain text without recursive expansion', () => {
  render(
    <QuestionWording
      {...props}
      value="<b>{option}</b> {metric}"
      values={{ ...values, option: '{workspace}', metric: '<img src=x>' }}
    />,
  );
  open();
  expect(screen.getByText('<b>{workspace}</b> <img src=x>')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull();
});
