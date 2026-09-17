"""Structural checks for the static design, independent of application trading."""
from html.parser import HTMLParser
from pathlib import Path
import unittest

class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children, self.text = [], ''
    def has(self, cls):
        return cls in self.attrs.get('class', '').split()
    def find(self, cls):
        return [c for c in self.children if c.has(cls)] + [n for c in self.children for n in c.find(cls)]
    def content(self):
        return self.text + ''.join(c.content() for c in self.children)

class Tree(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.root = self.current = Node()
        self.feed(source)
    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in ('meta', 'br', 'link', 'input', 'img', 'hr'):
            self.current = node
    def handle_endtag(self, tag):
        if self.current.parent:
            self.current = self.current.parent
    def handle_data(self, data):
        self.current.text += data

class ComparisonTests(unittest.TestCase):
    def test_open_limit_orders_are_always_below_the_dialog_with_cancel_only(self):
        root = Tree(Path(__file__).with_name('limit-order-ticket-before-after.html').read_text()).root
        examples = root.find('after')
        self.assertEqual(len(examples), 3)
        for example in examples:
            with self.subTest(example=example.content()):
                ticket, = example.find('ticket')
                orders, = example.find('open-orders')
                self.assertIs(orders.parent, ticket.parent)
                self.assertEqual(example.children.index(orders), example.children.index(ticket) + 1)
                self.assertIn('Open orders', orders.content())
                self.assertIn('Cancel', orders.content())
                self.assertNotIn('Sell', orders.content())
                self.assertNotIn('buy under', ticket.content())
                self.assertIn('Quick', ticket.content())
                self.assertIn('Limit', ticket.content())

if __name__ == '__main__':
    unittest.main()
